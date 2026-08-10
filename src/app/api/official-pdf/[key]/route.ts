import { NextResponse } from 'next/server';

const SOURCES: Record<string, string> = {
  w4: 'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
  i9: 'https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf',
};

export async function GET(_request: Request, { params }: { params: { key: string } }) {
  const source = SOURCES[params.key];
  if (!source) return NextResponse.json({ error: 'Unknown form' }, { status: 404 });
  try {
    const upstream = await fetch(source, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavesinkDerm-OnboardingPortal/1.0)' }, next: { revalidate: 3600 } });
    if (!upstream.ok) return NextResponse.json({ error: `Could not fetch the official form (status ${upstream.status}).` }, { status: 502 });
    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${params.key}.pdf"`, 'Cache-Control': 'public, max-age=3600' } });
  } catch (err) {
    console.error('Official PDF proxy failed', err);
    return NextResponse.json({ error: 'Could not load the official form right now.' }, { status: 502 });
  }
}
