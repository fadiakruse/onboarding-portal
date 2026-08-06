import { NextResponse } from 'next/server';

// routingnumbers.info has been shut down (the domain is now parked/for sale),
// so this now uses API Ninjas' routing number endpoint instead. Sign up for a
// free key at https://api.api-ninjas.com/ and set API_NINJAS_KEY in Vercel's
// environment variables. The free tier covers typical onboarding volume.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rn = (searchParams.get('rn') || '').replace(/\D/g, '');

  if (rn.length !== 9) {
    return NextResponse.json({ bankName: null });
  }

  const apiKey = process.env.API_NINJAS_KEY;
  if (!apiKey) {
    console.error('API_NINJAS_KEY is not set; routing lookup is disabled.');
    return NextResponse.json({ bankName: null });
  }

  try {
    const res = await fetch(`https://api.api-ninjas.com/v1/routingnumber?routing_number=${rn}`, {
      headers: { 'X-Api-Key': apiKey },
    });
    if (!res.ok) {
      return NextResponse.json({ bankName: null });
    }
    const data = (await res.json()) as Array<{ bank?: string }>;
    const bankName = Array.isArray(data) && data.length > 0 ? data[0].bank ?? null : null;
    return NextResponse.json({ bankName });
  } catch (err) {
    console.error('Routing lookup failed', err);
    return NextResponse.json({ bankName: null });
  }
}