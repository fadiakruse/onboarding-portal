import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@/lib/supabase/server';

// TEMPORARY / DIAGNOSTIC ONLY — delete this route once field names have
// been captured for the real fill-and-sign implementation.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (myProfile?.role !== 'manager') {
    return NextResponse.json({ error: 'Only managers can do this.' }, { status: 403 });
  }

  const res = await fetch('https://www.irs.gov/pub/irs-pdf/fw4.pdf', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavesinkDerm-OnboardingPortal/1.0)' },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Could not fetch W-4: ${res.status}` }, { status: 502 });
  }

  const bytes = await res.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);
  const form = pdfDoc.getForm();

  const fields = form.getFields().map((f) => {
    const widgets = f.acroField.getWidgets();
    const rect = widgets[0]?.getRectangle();
    return {
      name: f.getName(),
      type: f.constructor.name,
      page: rect ? Math.round(rect.x) + ',' + Math.round(rect.y) : null,
    };
  });

  return NextResponse.json({ totalFields: fields.length, fields });
}
