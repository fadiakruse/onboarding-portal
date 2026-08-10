import { NextResponse } from 'next/server';

// Uses Amazon Location Service's Places Autocomplete API (REST + API key auth,
// no AWS SDK/SigV4 needed). Requests the "Core" feature set so we get
// structured address components (number, street, city, state, zip) instead
// of just a free-form title, then reformats them ourselves as:
// "<number> <street> <secondary>, <City>, <State> <Zip>"

interface AutocompleteAddress {
  Label?: string;
  AddressNumber?: string;
  Street?: string;
  Locality?: string;
  Region?: { Code?: string; Name?: string };
  PostalCode?: string;
  SecondaryAddressComponents?: Array<{ Designator?: string; Number?: string }>;
}

interface AutocompleteResultItem {
  Title?: string;
  Address?: AutocompleteAddress;
}

function formatAddress(item: AutocompleteResultItem): string | null {
  const addr = item.Address;
  if (!addr) return item.Title || null;

  const number = addr.AddressNumber || '';
  const street = addr.Street || '';
  const secondaryComponent = addr.SecondaryAddressComponents?.[0];
  const secondary = secondaryComponent
    ? `${secondaryComponent.Designator || ''} ${secondaryComponent.Number || ''}`.trim()
    : '';

  const streetLine = [[number, street].filter(Boolean).join(' '), secondary]
    .filter(Boolean)
    .join(' ');

  const city = addr.Locality || '';
  const state = addr.Region?.Code || addr.Region?.Name || '';
  const zip = addr.PostalCode || '';
  const stateZip = [state, zip].filter(Boolean).join(' ');

  const full = [streetLine, city, stateZip].filter(Boolean).join(', ');
  return full || item.Title || null;
}

// Central New Jersey (Trenton) — used only to bias ranking toward NJ
// addresses first; it does not exclude other states from appearing.
const NJ_BIAS_POSITION = [-74.7597, 40.2206];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.trim().length < 4) {
    return NextResponse.json({ results: [] });
  }

  const apiKey = process.env.AWS_LOCATION_API_KEY;
  const region = process.env.AWS_LOCATION_REGION || 'us-east-1';

  if (!apiKey) {
    console.error('AWS_LOCATION_API_KEY is not set — address suggestions disabled.');
    return NextResponse.json({ results: [] });
  }

  try {
    const url = `https://places.geo.${region}.amazonaws.com/v2/autocomplete?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        QueryText: q,
        MaxResults: 5,
        AdditionalFeatures: ['Core'],
        BiasPosition: NJ_BIAS_POSITION,
        Filter: { IncludeCountries: ['USA'] },
      }),
    });

    if (!res.ok) {
      console.error('Amazon Location autocomplete failed', res.status, await res.text());
      return NextResponse.json({ results: [] });
    }

    const data = (await res.json()) as { ResultItems?: AutocompleteResultItem[] };
    const results = (data.ResultItems ?? [])
      .map(formatAddress)
      .filter((r): r is string => Boolean(r));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Amazon Location autocomplete error', err);
    return NextResponse.json({ results: [] });
  }
}
