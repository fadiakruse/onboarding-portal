import { NextResponse } from 'next/server';

// Free public routing-number lookup, no API key required.
// https://www.routingnumbers.info
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rn = (searchParams.get('rn') || '').replace(/\D/g, '');

  if (rn.length !== 9) {
    return NextResponse.json({ bankName: null });
  }

  try {
    const res = await fetch(`https://www.routingnumbers.info/api/data.json?rn=${rn}`);
    if (!res.ok) {
      return NextResponse.json({ bankName: null });
    }
    const data = (await res.json()) as { code?: number; name?: string };
    if (data.code === 1 && data.name) {
      return NextResponse.json({ bankName: data.name });
    }
    return NextResponse.json({ bankName: null });
  } catch (err) {
    console.error('Routing lookup failed', err);
    return NextResponse.json({ bankName: null });
  }
}
