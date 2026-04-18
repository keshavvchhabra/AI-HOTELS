import { readFileSync } from "node:fs";
import { createStructuredResponse, isOpenAIEnabled } from "./openai.js";
import { fetchHotelsForCity, isTripAdvisorEnabled } from "./tripadvisor.js";

const STATIC_HOTELS = JSON.parse(
  readFileSync(new URL("../data/hotels.json", import.meta.url), "utf8")
);

const RECOMMENDATION_COUNT = 5;

const SCORE_WEIGHTS = {
  location: 0.4,
  amenities: 0.2,
  budget: 0.2,
  tripType: 0.1,
  rating: 0.1
};

const AMENITY_OPTIONS = [
  "jacuzzi",
  "bathtub",
  "swimming_pool",
  "spa",
  "gym",
  "free_wifi",
  "parking",
  "breakfast_included",
  "air_conditioning"
];

const TRIP_TYPE_OPTIONS = ["family", "couple", "friends", "solo"];
const EXPERIENCE_OPTIONS = ["luxury", "budget", "peaceful", "nightlife", "cultural", "work_friendly"];

const DEFAULT_PREFERENCES = {
  trip_type: "",
  amenities: [],
  experience: []
};

const MATCH_TIERS = {
  strict: "strict",
  relaxed: "relaxed",
  fallback: "fallback"
};

const CITY_ALIASES = {
  delhi: ["delhi", "new delhi"],
  jaipur: ["jaipur", "pink city"],
  goa: ["goa", "north goa", "south goa"],
  manali: ["manali", "old manali"]
};

const AMENITY_KEYWORDS = {
  jacuzzi: ["jacuzzi", "hot tub"],
  bathtub: ["bathtub", "bath tub", "tub"],
  swimming_pool: ["swimming pool", "pool"],
  spa: ["spa"],
  gym: ["gym", "fitness"],
  free_wifi: ["wifi", "wi-fi", "internet"],
  parking: ["parking", "car park"],
  breakfast_included: ["breakfast"],
  air_conditioning: ["air conditioning", "ac"]
};

const EXPERIENCE_KEYWORDS = {
  luxury: ["luxury", "premium", "upscale"],
  budget: ["budget", "affordable", "value"],
  peaceful: ["peaceful", "quiet", "calm"],
  nightlife: ["nightlife", "party", "bars", "clubs"],
  cultural: ["cultural", "heritage", "local feel"],
  work_friendly: ["work friendly", "work-friendly", "remote work", "business"]
};

const TRIP_TYPE_KEYWORDS = {
  family: ["family", "kids", "parents"],
  couple: ["couple", "partner", "honeymoon", "romantic"],
  friends: ["friends", "group", "gang"],
  solo: ["solo", "alone", "myself"]
};

const HIGHLIGHT_LABELS = {
  family: "Family Friendly",
  pool: "Pool Available",
  budget: "Budget Friendly",
  city_center: "Near City Center",
  premium: "Premium Stay",
  spa: "Spa Access",
  cultural: "Cultural Vibe",
  nightlife: "Nightlife Nearby",
  beach: "Near Beach",
  mountain_view: "Mountain Views",
  work_friendly: "Work Friendly",
  near_airport: "Near Airport",
  free_wifi: "Free WiFi",
  breakfast_included: "Breakfast Included",
  jacuzzi: "Jacuzzi Included",
  swimming_pool: "Swimming Pool",
  air_conditioning: "Air Conditioning"
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function titleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeKey(value) {
  const normalizedValue = normalizeKey(value);

  if (normalizedValue === "free_wifi") return "Free WiFi";
  if (normalizedValue === "work_friendly") return "Work-friendly";

  return titleCase(normalizedValue.replaceAll("_", " "));
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeArray(values) {
  return unique((values || []).map((value) => normalizeKey(value)).filter(Boolean));
}

function normalizePreferences(rawPreferences = {}) {
  const tripType = normalizeKey(rawPreferences.trip_type);

  return {
    trip_type: TRIP_TYPE_OPTIONS.includes(tripType) ? tripType : "",
    amenities: normalizeArray(rawPreferences.amenities).filter((value) => AMENITY_OPTIONS.includes(value)),
    experience: normalizeArray(rawPreferences.experience).filter((value) => EXPERIENCE_OPTIONS.includes(value))
  };
}

function buildStructuredPromptHint(preferences) {
  const parts = [];

  if (preferences.trip_type) {
    parts.push(`Trip type: ${humanizeKey(preferences.trip_type)}`);
  }

  if (preferences.amenities.length) {
    parts.push(`Amenities: ${preferences.amenities.map(humanizeKey).join(", ")}`);
  }

  if (preferences.experience.length) {
    parts.push(`Experience: ${preferences.experience.map(humanizeKey).join(", ")}`);
  }

  return parts.length ? `${parts.join(". ")}.` : "";
}

function canonicalizeCity(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  for (const [city, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.includes(normalizedValue)) {
      return titleCase(city);
    }
  }

  return titleCase(normalizedValue);
}

function extractBudget(query) {
  const patterns = [
    /(?:budget|under|around|within)\s*(?:of\s*)?(?:rs\.?|inr|₹)?\s*([\d,]+)/i,
    /(?:rs\.?|inr|₹)\s*([\d,]+)\s*(?:per night|night|\/night)?/i,
    /([\d,]+)\s*(?:per night|nightly|\/night)/i
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      return Number(match[1].replaceAll(",", ""));
    }
  }

  return null;
}

function extractLocation(query) {
  const normalizedQuery = normalizeText(query);

  for (const [city, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((alias) => normalizedQuery.includes(alias))) {
      return titleCase(city);
    }
  }

  const match = query.match(/\bin\s+([a-z\s]+?)(?:\s+under|\s+around|\s+with|\s+for|$)/i);
  return match?.[1] ? canonicalizeCity(match[1]) : "";
}

function extractTripType(query) {
  const normalizedQuery = normalizeText(query);

  for (const [tripType, keywords] of Object.entries(TRIP_TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedQuery.includes(keyword))) {
      return tripType;
    }
  }

  return "unknown";
}

function extractSignals(query, keywordMap) {
  const normalizedQuery = normalizeText(query);
  const matches = [];

  for (const [signal, keywords] of Object.entries(keywordMap)) {
    if (keywords.some((keyword) => normalizedQuery.includes(keyword))) {
      matches.push(signal);
    }
  }

  return unique(matches);
}

function normalizeIntent(intent, rawQuery) {
  return {
    rawQuery,
    location: canonicalizeCity(intent.location),
    budgetPerNight: Number(intent.budgetPerNight) > 0 ? Number(intent.budgetPerNight) : null,
    tripType: TRIP_TYPE_OPTIONS.includes(normalizeKey(intent.tripType))
      ? normalizeKey(intent.tripType)
      : "unknown",
    amenitySignals: normalizeArray(intent.amenitySignals).filter((value) => AMENITY_OPTIONS.includes(value)),
    experienceSignals: normalizeArray(intent.experienceSignals).filter((value) => EXPERIENCE_OPTIONS.includes(value)),
    confidence: Math.max(0.25, Math.min(0.98, Number(intent.confidence) || 0.45))
  };
}

function fallbackIntentExtraction(query, preferences) {
  const augmentedQuery = `${query} ${buildStructuredPromptHint(preferences)}`.trim();

  let confidence = 0.34;
  const location = extractLocation(augmentedQuery);
  const budgetPerNight = extractBudget(augmentedQuery);
  const tripType = preferences.trip_type || extractTripType(augmentedQuery);
  const amenitySignals = unique([...preferences.amenities, ...extractSignals(augmentedQuery, AMENITY_KEYWORDS)]);
  const experienceSignals = unique([...preferences.experience, ...extractSignals(augmentedQuery, EXPERIENCE_KEYWORDS)]);

  if (location) confidence += 0.2;
  if (budgetPerNight) confidence += 0.12;
  if (tripType && tripType !== "unknown") confidence += 0.1;
  confidence += Math.min(amenitySignals.length * 0.04, 0.12);
  confidence += Math.min(experienceSignals.length * 0.03, 0.08);

  return normalizeIntent(
    {
      location,
      budgetPerNight,
      tripType,
      amenitySignals,
      experienceSignals,
      confidence
    },
    query
  );
}

async function extractIntent(query, preferences) {
  if (!isOpenAIEnabled()) {
    return fallbackIntentExtraction(query, preferences);
  }

  try {
    const parsed = await createStructuredResponse({
      name: "hotel_discovery_intent",
      instructions: [
        "Extract travel hotel intent from the user's natural language and structured preference note.",
        "Return valid JSON only.",
        "Normalize city names like New Delhi to Delhi.",
        "Trip type must be one of family, couple, friends, solo, or unknown.",
        "Amenity signals must use: jacuzzi, bathtub, swimming_pool, spa, gym, free_wifi, parking, breakfast_included, air_conditioning.",
        "Experience signals must use: luxury, budget, peaceful, nightlife, cultural, work_friendly."
      ].join(" "),
      input: `${query}\n${buildStructuredPromptHint(preferences)}`.trim(),
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "location",
          "budgetPerNight",
          "tripType",
          "amenitySignals",
          "experienceSignals",
          "confidence"
        ],
        properties: {
          location: { type: "string" },
          budgetPerNight: { type: "integer", minimum: 0 },
          tripType: {
            type: "string",
            enum: ["family", "couple", "friends", "solo", "unknown"]
          },
          amenitySignals: {
            type: "array",
            items: { type: "string" }
          },
          experienceSignals: {
            type: "array",
            items: { type: "string" }
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1
          }
        }
      }
    });

    return normalizeIntent(parsed, query);
  } catch {
    return fallbackIntentExtraction(query, preferences);
  }
}

function buildSearchContext(intent, preferences) {
  return {
    location: intent.location,
    budgetPerNight: intent.budgetPerNight,
    tripType: preferences.trip_type || intent.tripType,
    amenities: unique([...preferences.amenities, ...intent.amenitySignals]),
    experience: unique([...preferences.experience, ...intent.experienceSignals]),
    confidence: intent.confidence
  };
}

async function getCityHotels(searchContext) {
  if (isTripAdvisorEnabled() && searchContext.location) {
    try {
      const liveHotels = await fetchHotelsForCity(searchContext.location);
      if (liveHotels.length > 0) return liveHotels;
    } catch (err) {
      console.warn(`[TripAdvisor] fetch failed for "${searchContext.location}": ${err.message} — falling back to static catalog`);
    }
  }

  /* Fallback: static catalog */
  const all = STATIC_HOTELS;
  if (!searchContext.location) return all;
  return all.filter((hotel) => normalizeText(hotel.city) === normalizeText(searchContext.location));
}

function getLocationStatus(searchContext, cityHotels) {
  if (!searchContext.location) {
    return {
      cityMatched: false,
      message: "No city was detected, so hotels are ranked across the full catalog.",
      label: "All cities"
    };
  }

  return {
    cityMatched: cityHotels.length > 0,
    message: `Showing hotels only in ${searchContext.location}.`,
    label: `City match: ${searchContext.location}`
  };
}

function getLocationScore(searchContext, hotel) {
  if (!searchContext.location) {
    return 0.72;
  }

  return normalizeText(hotel.city) === normalizeText(searchContext.location) ? 1 : 0;
}

function getAmenityRatio(searchContext, hotel) {
  if (!searchContext.amenities.length) {
    return 0.75;
  }

  const matchedAmenities = searchContext.amenities.filter((amenity) => hotel.amenities.includes(amenity));
  return matchedAmenities.length / searchContext.amenities.length;
}

function getTripTypeScore(searchContext, hotel, tier) {
  if (!searchContext.tripType || searchContext.tripType === "unknown") {
    return 0.75;
  }

  if (hotel.trip_types.includes(searchContext.tripType)) {
    return 1;
  }

  if (tier === MATCH_TIERS.relaxed) {
    return 0.4;
  }

  if (tier === MATCH_TIERS.fallback) {
    return 0.52;
  }

  return 0;
}

function getBudgetScore(searchContext, hotel, tier) {
  if (!searchContext.budgetPerNight) {
    return 0.75;
  }

  const strictBudget = searchContext.budgetPerNight;
  const relaxedBudget = Math.round(strictBudget * 1.2);

  if (hotel.price <= strictBudget) {
    const savingsRatio = (strictBudget - hotel.price) / Math.max(strictBudget, 1);
    return Math.max(0.82, 1 - savingsRatio * 0.18);
  }

  if (tier === MATCH_TIERS.relaxed && hotel.price <= relaxedBudget) {
    const overflowRatio = (hotel.price - strictBudget) / Math.max(relaxedBudget - strictBudget, 1);
    return Math.max(0.42, 0.72 - overflowRatio * 0.28);
  }

  if (tier === MATCH_TIERS.fallback) {
    if (hotel.price <= relaxedBudget) {
      const overflowRatio = (hotel.price - strictBudget) / Math.max(relaxedBudget - strictBudget, 1);
      return Math.max(0.46, 0.78 - overflowRatio * 0.22);
    }

    const deepOverflow = (hotel.price - relaxedBudget) / Math.max(relaxedBudget, 1);
    return Math.max(0.18, 0.44 - deepOverflow * 0.24);
  }

  return 0;
}

function getRatingScore(hotel) {
  return Math.max(0, Math.min(1, hotel.rating / 5));
}

function getScore(searchContext, hotel, tier) {
  const location = getLocationScore(searchContext, hotel);
  const amenities = getAmenityRatio(searchContext, hotel);
  const budget = getBudgetScore(searchContext, hotel, tier);
  const tripType = getTripTypeScore(searchContext, hotel, tier);
  const rating = getRatingScore(hotel);

  return {
    raw:
      location * SCORE_WEIGHTS.location +
      amenities * SCORE_WEIGHTS.amenities +
      budget * SCORE_WEIGHTS.budget +
      tripType * SCORE_WEIGHTS.tripType +
      rating * SCORE_WEIGHTS.rating,
    breakdown: {
      location: Math.round(location * 100),
      amenities: Math.round(amenities * 100),
      budget: Math.round(budget * 100),
      tripType: Math.round(tripType * 100),
      rating: Math.round(rating * 100)
    }
  };
}

function passesStrictFilters(searchContext, hotel) {
  if (searchContext.location && normalizeText(hotel.city) !== normalizeText(searchContext.location)) {
    return false;
  }

  if (searchContext.amenities.length && !searchContext.amenities.every((amenity) => hotel.amenities.includes(amenity))) {
    return false;
  }

  if (searchContext.tripType && searchContext.tripType !== "unknown" && !hotel.trip_types.includes(searchContext.tripType)) {
    return false;
  }

  if (searchContext.budgetPerNight && hotel.price > searchContext.budgetPerNight) {
    return false;
  }

  return true;
}

function passesRelaxedFilters(searchContext, hotel) {
  if (searchContext.location && normalizeText(hotel.city) !== normalizeText(searchContext.location)) {
    return false;
  }

  if (searchContext.budgetPerNight && hotel.price > Math.round(searchContext.budgetPerNight * 1.2)) {
    return false;
  }

  return true;
}

function getPriceQualityScore(searchContext, hotel, cityHotels) {
  if (searchContext.budgetPerNight) {
    return getBudgetScore(searchContext, hotel, MATCH_TIERS.fallback);
  }

  const prices = cityHotels.map((item) => item.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  if (maxPrice === minPrice) {
    return 0.72;
  }

  return 1 - ((hotel.price - minPrice) / (maxPrice - minPrice));
}

function sortByTierRelevance(left, right) {
  if (right.scoreRaw !== left.scoreRaw) {
    return right.scoreRaw - left.scoreRaw;
  }

  if (right.rating !== left.rating) {
    return right.rating - left.rating;
  }

  return left.price - right.price;
}

function getTopFillHotels(searchContext, cityHotels, seenIds) {
  return cityHotels
    .filter((hotel) => !seenIds.has(hotel.id))
    .map((hotel) => ({
      ...hotel,
      popularityScore: getRatingScore(hotel) * 0.7 + getPriceQualityScore(searchContext, hotel, cityHotels) * 0.3
    }))
    .sort((left, right) => {
      if (right.popularityScore !== left.popularityScore) {
        return right.popularityScore - left.popularityScore;
      }

      if (right.rating !== left.rating) {
        return right.rating - left.rating;
      }

      return left.price - right.price;
    });
}

function enrichHotel(searchContext, hotel, tier) {
  const score = getScore(searchContext, hotel, tier);
  const matchedAmenities = searchContext.amenities.filter((amenity) => hotel.amenities.includes(amenity));

  return {
    ...hotel,
    id: normalizeKey(`${hotel.city}-${hotel.name}`),
    scoreRaw: score.raw,
    matchScore: Math.round(score.raw * 100),
    matchedAmenities,
    scoreBreakdown: score.breakdown,
    matchTier: tier
  };
}

function getKeyHighlights(hotel, matchedAmenities) {
  const orderedSignals = unique([
    ...matchedAmenities,
    ...(hotel.tags || []),
    ...(hotel.amenities || [])
  ]);

  return orderedSignals
    .map((signal) => HIGHLIGHT_LABELS[signal] || humanizeKey(signal))
    .filter(Boolean)
    .slice(0, 3);
}

function buildStrictExplanation(searchContext, hotel) {
  const parts = [];

  if (searchContext.location) {
    parts.push(`your ${searchContext.location} location`);
  }

  if (searchContext.budgetPerNight) {
    parts.push(`your ${formatCurrency(searchContext.budgetPerNight)} budget`);
  }

  if (searchContext.amenities.length) {
    parts.push(`amenities like ${searchContext.amenities.slice(0, 2).map(humanizeKey).join(" and ")}`);
  }

  if (searchContext.tripType && searchContext.tripType !== "unknown") {
    parts.push(`your ${humanizeKey(searchContext.tripType).toLowerCase()} trip`);
  }

  return `Perfect match for your preferences including ${parts.join(", ")}.`;
}

function buildRelaxedExplanation(searchContext, hotel) {
  const relaxedBits = [];
  const matchedAmenityCount = searchContext.amenities.filter((amenity) => hotel.amenities.includes(amenity)).length;

  if (searchContext.amenities.length && matchedAmenityCount < searchContext.amenities.length) {
    relaxedBits.push("only partially fits your selected amenities");
  }

  if (searchContext.tripType && searchContext.tripType !== "unknown" && !hotel.trip_types.includes(searchContext.tripType)) {
    relaxedBits.push("does not fully match your selected trip type");
  }

  if (searchContext.budgetPerNight && hotel.price > searchContext.budgetPerNight) {
    relaxedBits.push(`sits slightly above your budget at ${formatCurrency(hotel.price)}`);
  }

  if (!relaxedBits.length) {
    relaxedBits.push("was added as a broader same-city alternative");
  }

  return `Matches your location in ${hotel.city}, but ${relaxedBits.join(" and ")}.`;
}

function buildFallbackExplanation(searchContext, hotel) {
  return `Added as one of the top-rated hotels in ${hotel.city} to complete your options.`;
}

function getExplanation(searchContext, hotel) {
  if (hotel.matchTier === MATCH_TIERS.strict) {
    return buildStrictExplanation(searchContext, hotel);
  }

  if (hotel.matchTier === MATCH_TIERS.relaxed) {
    return buildRelaxedExplanation(searchContext, hotel);
  }

  return buildFallbackExplanation(searchContext, hotel);
}

function assignPresentation(finalHotels) {
  return finalHotels.map((hotel, index) => {
    let matchLabel = "Good Match";
    let fallbackBadge = "";

    if (hotel.matchTier === MATCH_TIERS.strict && index === 0) {
      matchLabel = "Best Match";
    } else if (hotel.matchTier === MATCH_TIERS.fallback) {
      matchLabel = "Top Pick";
      fallbackBadge = "Popular Choice";
    } else if (hotel.matchTier === MATCH_TIERS.relaxed) {
      fallbackBadge = "Recommended Alternative";
    }

    return {
      ...hotel,
      matchLabel,
      fallbackBadge
    };
  });
}

function formatCurrency(value) {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function buildSummary(searchContext, finalHotels, layerCounts) {
  if (!finalHotels.length) {
    return searchContext.location
      ? `No hotels were found in ${searchContext.location}.`
      : "No hotels matched the current request.";
  }

  const leadHotel = finalHotels[0];
  const strictLine = layerCounts.strict
    ? `${layerCounts.strict} strict match${layerCounts.strict > 1 ? "es" : ""}`
    : "0 strict matches";
  const relaxedLine = layerCounts.relaxed
    ? `${layerCounts.relaxed} relaxed alternative${layerCounts.relaxed > 1 ? "s" : ""}`
    : "0 relaxed alternatives";
  const fillLine = layerCounts.fallback
    ? `${layerCounts.fallback} top pick${layerCounts.fallback > 1 ? "s" : ""}`
    : "0 top picks";

  return `${leadHotel.name} leads the list. Built from ${strictLine}, ${relaxedLine}, and ${fillLine} in ${searchContext.location || "the catalog"}.`;
}

function buildRefinementSuggestions(searchContext) {
  const suggestions = [];

  if (!searchContext.budgetPerNight) {
    suggestions.push("add a nightly budget");
  } else {
    suggestions.push("tighten the budget");
  }

  if (!searchContext.amenities.length) {
    suggestions.push("add must-have amenities");
  }

  if (!searchContext.tripType || searchContext.tripType === "unknown") {
    suggestions.push("specify a trip type");
  }

  if (!suggestions.length) {
    suggestions.push("ask for more premium stays");
    suggestions.push("ask for more budget-friendly hotels");
  }

  return suggestions.slice(0, 3);
}

export async function searchHotels(query = "", rawPreferences = DEFAULT_PREFERENCES) {
  const preferences = normalizePreferences(rawPreferences);
  const intent = await extractIntent(query, preferences);
  const searchContext = buildSearchContext(intent, preferences);
  const cityHotels = (await getCityHotels(searchContext)).map((hotel) => ({
    ...hotel,
    id: normalizeKey(`${hotel.city}-${hotel.name}`)
  }));
  const locationStatus = getLocationStatus(searchContext, cityHotels);
  const selectedIds = new Set();

  const strictResults = cityHotels
    .filter((hotel) => passesStrictFilters(searchContext, hotel))
    .map((hotel) => enrichHotel(searchContext, hotel, MATCH_TIERS.strict))
    .sort(sortByTierRelevance);

  const strictSelected = strictResults.slice(0, RECOMMENDATION_COUNT);
  strictSelected.forEach((hotel) => selectedIds.add(hotel.id));

  const relaxedResults = cityHotels
    .filter((hotel) => !selectedIds.has(hotel.id))
    .filter((hotel) => passesRelaxedFilters(searchContext, hotel))
    .map((hotel) => enrichHotel(searchContext, hotel, MATCH_TIERS.relaxed))
    .sort(sortByTierRelevance);

  const remainingAfterStrict = Math.max(0, RECOMMENDATION_COUNT - strictSelected.length);
  const relaxedSelected = relaxedResults.slice(0, remainingAfterStrict);
  relaxedSelected.forEach((hotel) => selectedIds.add(hotel.id));

  const fallbackResults = getTopFillHotels(searchContext, cityHotels, selectedIds)
    .map((hotel) => enrichHotel(searchContext, hotel, MATCH_TIERS.fallback));

  const remainingAfterRelaxed = Math.max(0, RECOMMENDATION_COUNT - strictSelected.length - relaxedSelected.length);
  const fallbackSelected = fallbackResults.slice(0, remainingAfterRelaxed);
  fallbackSelected.forEach((hotel) => selectedIds.add(hotel.id));

  const combined = [...strictSelected, ...relaxedSelected, ...fallbackSelected].slice(0, RECOMMENDATION_COUNT);
  const finalHotels = assignPresentation(combined).map((hotel) => ({
    id: hotel.id,
    name: hotel.name,
    city: hotel.city,
    area: hotel.area,
    price: hotel.price,
    rating: hotel.rating,
    image: hotel.image,
    booking_link: hotel.booking_link,
    tags: hotel.tags,
    amenities: hotel.amenities,
    trip_types: hotel.trip_types,
    experience: hotel.experience,
    matchTier: hotel.matchTier,
    matchScore: hotel.matchScore,
    matchLabel: hotel.matchLabel,
    fallbackBadge: hotel.fallbackBadge,
    highlights: getKeyHighlights(hotel, hotel.matchedAmenities),
    explanation: getExplanation(searchContext, hotel),
    description: hotel.description,
    matchedAmenities: hotel.matchedAmenities,
    scoreBreakdown: hotel.scoreBreakdown
  }));

  const layerCounts = {
    strict: strictSelected.length,
    relaxed: relaxedSelected.length,
    fallback: fallbackSelected.length
  };

  const overallConfidence = Math.round(
    ((finalHotels[0]?.matchScore || 60) * 0.7) + (searchContext.confidence * 100 * 0.3)
  );

  return {
    query,
    selectedPreferences: preferences,
    intent: {
      location: searchContext.location,
      budgetPerNight: searchContext.budgetPerNight,
      tripType: searchContext.tripType,
      amenitySignals: searchContext.amenities,
      experienceSignals: searchContext.experience,
      confidence: searchContext.confidence
    },
    confidence: overallConfidence,
    locationStatus,
    summary: buildSummary(searchContext, finalHotels, layerCounts),
    hotels: finalHotels,
    refinementSuggestions: buildRefinementSuggestions(searchContext),
    meta: {
      totalHotels: cityHotels.length,
      cityFilteredHotels: cityHotels.length,
      scoringWeights: SCORE_WEIGHTS,
      layerCounts,
      aiMode: isOpenAIEnabled() ? "openai" : "heuristic"
    }
  };
}
