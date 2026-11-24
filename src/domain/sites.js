// Known IDC sites for the map entry screen. Coordinates are approximate (nearest station / city hall,
// tolerance ±0.02°); replace with the real addresses when available. Pure.

/**
 * build_name → {lat, lng, label}; `tag` places the map label (dx/dy in map px, text-anchor) so the two
 * nearby Seoul sites (가산 / 영등포, ~4 km apart) do not overlap.
 */
export const SITES = {
  가산IDC: { lat: 37.4816, lng: 126.8827, label: '가산', tag: { dx: -18, dy: 28, anchor: 'end' } },
  영등포IDC: { lat: 37.5157, lng: 126.9074, label: '영등포', tag: { dx: 16, dy: -14, anchor: 'start' } },
  파주IDC: { lat: 37.7599, lng: 126.78, label: '파주', tag: { dx: 16, dy: -14, anchor: 'start' } },
};

export const isKnownSite = (name) => Object.prototype.hasOwnProperty.call(SITES, name);

/** `unknown-build` warnings for datacenters with no map pin (they are listed beside the map instead). */
export function checkSites(data) {
  return data.datacenters
    .filter((dc) => !isKnownSite(dc.name) && !isKnownSite(dc.id))
    .map((dc) => ({
      path: dc.id,
      kind: 'unknown-build',
      message: `미등록 데이터센터 "${dc.name}": 지도에 위치가 없어 지도 옆 목록에만 표시합니다`,
      target: { dc: dc.id },
    }));
}

/** Pin position of a datacenter, or null when it is not a known site. */
export const siteOf = (dc) => SITES[dc.name] ?? SITES[dc.id] ?? null;
