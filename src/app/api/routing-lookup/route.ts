import { NextResponse } from 'next/server';

// Uses bankrouting.io — a genuinely free, no-key, no-auth API built on the
// Federal Reserve's routing number directory. Replaces both the old dead
// routingnumbers.info domain and API Ninjas (whose bank_name field turned
// out to be premium-only). Rate limit: 100 req/hour/IP, well above onboarding
// volume. See https://bankrouting.io/ for details.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rn = (searchParams.get('rn') || '').replace(/\D/g, '');

  if (rn.length !== 9) {
    return NextResponse.json({ bankName: null });
  }

  try {
    const res = await fetch(`https://bankrouting.io/api/v1/aba/${rn}`);

    if (!res.ok) {
      // 400 = invalid checksum, 404 = valid number but bank not in database.
      // Either way, no bank name available — fail gracefully, no crash.
      return NextResponse.json({ bankName: null });
    }

    const data = (await res.json()) as {
      status?: string;
      data?: { bank_name?: string };
    };

    const bankName = data.status === 'success' ? data.data?.bank_name ?? null : null;
    return NextResponse.json({ bankName });
  } catch (err) {
    console.error('Routing lookup failed', err);
    return NextResponse.json({ bankName: null });
  }
}
