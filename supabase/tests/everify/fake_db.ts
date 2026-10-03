// Minimal in-memory stand-in for the parts of supabase-js the function uses (tests only).
type Row = Record<string, any>;
const PK: Record<string, string> = { everify_staff: "user_id", everify_token_cache: "id" };

export function fakeDb(users: Record<string, { id: string; email: string }>) {
  const T: Record<string, Row[]> = { everify_staff: [], everify_clients: [], i9_cases: [], everify_events: [], everify_token_cache: [] };
  const authUsers = Object.values(users);
  const join = (table: string, sel: string, r: Row) => {
    const out = { ...r };
    if (table === "i9_cases" && sel.includes("client:everify_clients")) out.client = T.everify_clients.find((c) => c.id === r.client_id) ?? null;
    return out;
  };
  function q(table: string) {
    let op: "select" | "insert" | "update" | "upsert" = "select", payload: any, sel = "*", single = 0;
    const filters: ((r: Row) => boolean)[] = []; let lim = 1e9;
    const run = () => {
      const rows = T[table];
      if (op === "insert") {
        const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), other_last_names: [], ...payload };
        rows.push(r); return { data: join(table, sel, r), error: null };
      }
      if (op === "upsert") {
        const pk = PK[table] ?? "id"; const i = rows.findIndex((r) => r[pk] === payload[pk]);
        if (i >= 0) rows[i] = { ...rows[i], ...payload }; else rows.push({ id: crypto.randomUUID(), ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload, { updated_at: new Date().toISOString() })); return { data: null, error: null }; }
      const data = hit.slice(0, lim).map((r) => join(table, sel, r));
      if (single) { if (single === 2 && !data.length) return { data: null, error: { message: "no rows" } }; return { data: data[0] ?? null, error: null }; }
      return { data, error: null };
    };
    const b: any = {
      select(s = "*") { sel = s; return b; },
      insert(p: any) { op = "insert"; payload = p; return b; },
      update(p: any) { op = "update"; payload = p; return b; },
      upsert(p: any) { op = "upsert"; payload = p; return b; },
      eq(k: string, v: any) { filters.push((r) => r[k] === v); return b; },
      neq(k: string, v: any) { filters.push((r) => r[k] !== v); return b; },
      order() { return b; }, limit(n: number) { lim = n; return b; },
      maybeSingle() { single = 1; return Promise.resolve(run()); },
      single() { single = 2; return Promise.resolve(run()); },
      then(ok: any, no: any) { return Promise.resolve(run()).then(ok, no); },
    };
    return b;
  }
  const db: any = {
    T,
    from: q,
    auth: {
      getUser: async (jwt: string) => users[jwt] ? { data: { user: users[jwt] }, error: null } : { data: { user: null }, error: { message: "bad jwt" } },
      admin: {
        inviteUserByEmail: async (email: string) => {
          if (authUsers.find((u) => u.email === email)) return { data: { user: null }, error: { message: "already registered" } };
          const u = { id: crypto.randomUUID(), email }; authUsers.push(u); return { data: { user: u }, error: null };
        },
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
      },
    },
  };
  return db;
}
