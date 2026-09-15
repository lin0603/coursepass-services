// Placement: short cross-topic assessment set — Phase P2.
export async function fetchPlacement(api, auth, unit, limit = 5) {
  const url = `${api}/v1/units/${encodeURIComponent(unit)}/placement?limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
