const BASE_URL = "https://tripadvisor16.p.rapidapi.com/api/v1";

/* Pre-resolved geoIds — saves 1 API call per city */
const KNOWN_GEO_IDS = {
  delhi: "304551", "new delhi": "304551",
  jaipur: "304554", "pink city": "304554",
  goa: "297604", "north goa": "297604", "south goa": "297604",
  mumbai: "306695", bombay: "306695",
  manali: "1508827", "old manali": "1508827",
  bangalore: "297622", bengaluru: "297622",
  kolkata: "304558", calcutta: "304558",
  chennai: "297687", madras: "297687",
  hyderabad: "297586",
  pune: "304575",
  udaipur: "304472",
  agra: "303978",
  varanasi: "304724",
  amritsar: "188836",
  kerala: "293860",
  shimla: "503775",
  rishikesh: "503655",
};

const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getApiKey() { return process.env.RAPIDAPI_KEY || ""; }
export function isTripAdvisorEnabled() { return Boolean(getApiKey()); }

async function apiGet(endpoint, params = {}) {
  const key = getApiKey();
  if (!key) throw new Error("RAPIDAPI_KEY not set");

  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const resp = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "tripadvisor16.p.rapidapi.com",
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) throw new Error(`TripAdvisor ${resp.status}`);
  const data = await resp.json();
  if (data.status === false) throw new Error(JSON.stringify(data.message));
  return data;
}

async function resolveGeoId(cityName) {
  const key = cityName.toLowerCase().trim();
  if (KNOWN_GEO_IDS[key]) return KNOWN_GEO_IDS[key];

  // Dynamic lookup — response has `geoId` field (not `locationId`)
  const data = await apiGet("/hotels/searchLocation", { query: cityName });
  const results = Array.isArray(data.data) ? data.data : [];
  const match = results.find((r) => r.trackingItems === "CITY") || results[0];
  if (!match?.geoId) throw new Error(`City not found: ${cityName}`);
  return String(match.geoId);
}

function defaultDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 7);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { checkIn: fmt(checkIn), checkOut: fmt(checkOut) };
}

function parsePriceString(str) {
  if (!str) return null;
  const val = parseFloat(String(str).replace(/[^\d.]/g, ""));
  return isNaN(val) || val === 0 ? null : Math.round(val);
}

function extractPhotoUrl(cardPhotos) {
  const tmpl = cardPhotos?.[0]?.sizes?.urlTemplate;
  if (!tmpl) return null;
  return tmpl.replace("{width}", "600").replace("{height}", "400");
}

function inferExperience(price) {
  if (price && price < 3500) return ["budget"];
  if (price && price > 7000) return ["luxury"];
  return ["budget"];
}

function inferTags(price, rating) {
  const tags = [];
  if (price && price < 3500) tags.push("budget");
  if (price && price > 7000) tags.push("premium");
  if (rating >= 4.5) tags.push("top_rated");
  return tags;
}

function buildBookingLink(raw) {
  const ext = raw.commerceInfo?.externalUrl || "";
  if (ext.startsWith("http")) return ext;
  return `https://www.tripadvisor.in/Hotel_Review-d${raw.id}.html`;
}

function normalizeHotel(raw, cityName) {
  const price = parsePriceString(raw.priceForDisplay);
  const rating = parseFloat(raw.bubbleRating?.rating) || 3.5;
  const area = raw.secondaryInfo || raw.primaryInfo || cityName;
  const image =
    extractPhotoUrl(raw.cardPhotos) ||
    `https://picsum.photos/seed/ta-${raw.id}/600/400`;

  return {
    id: `ta-${raw.id}`,
    name: raw.title || "Hotel",
    city: cityName,
    area,
    price: price || 4500,
    rating,
    image,
    booking_link: buildBookingLink(raw),
    tags: inferTags(price, rating),
    amenities: ["free_wifi", "air_conditioning"],
    trip_types: ["family", "couple", "friends", "solo"],
    experience: inferExperience(price),
    description: `${raw.title}${area !== cityName ? " — " + area : ""}, ${cityName}. Rated ${rating}/5 by ${raw.bubbleRating?.count || "travellers"} on TripAdvisor.`,
  };
}

export async function fetchHotelsForCity(cityName) {
  const cacheKey = cityName.toLowerCase().trim();
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.hotels;

  const geoId = await resolveGeoId(cityName);
  const { checkIn, checkOut } = defaultDates();

  // NOTE: Hotel search uses `geoId` param (not `locationId`)
  const data = await apiGet("/hotels/searchHotels", {
    geoId,
    checkIn,
    checkOut,
    pageNumber: "1",
    currencyCode: "INR",
  });

  const rawList = data?.data?.data || [];
  const hotels = rawList.filter((h) => h.id && h.title).map((h) => normalizeHotel(h, cityName));

  _cache.set(cacheKey, { hotels, timestamp: Date.now() });
  console.log(`[TripAdvisor] Loaded ${hotels.length} hotels for "${cityName}" (geoId: ${geoId})`);
  return hotels;
}
