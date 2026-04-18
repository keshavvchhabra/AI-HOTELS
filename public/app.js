const { useMemo, useState } = React;
const root = ReactDOM.createRoot(document.getElementById("root"));

const e = React.createElement;
const Fragment = React.Fragment;

const FILTER_OPTIONS = {
  amenities: [
    { label: "Jacuzzi", value: "jacuzzi" },
    { label: "Bathtub", value: "bathtub" },
    { label: "Swimming Pool", value: "swimming_pool" },
    { label: "Spa", value: "spa" },
    { label: "Gym", value: "gym" },
    { label: "Free WiFi", value: "free_wifi" },
    { label: "Parking", value: "parking" },
    { label: "Breakfast Included", value: "breakfast_included" },
    { label: "Air Conditioning", value: "air_conditioning" }
  ],
  tripType: [
    { label: "Family", value: "family" },
    { label: "Couple", value: "couple" },
    { label: "Friends", value: "friends" },
    { label: "Solo", value: "solo" }
  ],
  experience: [
    { label: "Luxury", value: "luxury" },
    { label: "Budget", value: "budget" },
    { label: "Peaceful", value: "peaceful" },
    { label: "Nightlife", value: "nightlife" },
    { label: "Cultural", value: "cultural" },
    { label: "Work-friendly", value: "work_friendly" }
  ]
};

const EXAMPLE_SEARCHES = [
  {
    label: "Jaipur family escape",
    query: "Family trip in Jaipur under ₹5000",
    preferences: {
      trip_type: "family",
      amenities: ["swimming_pool", "free_wifi"],
      experience: ["budget", "cultural"]
    }
  },
  {
    label: "Goa beach friends",
    query: "Goa trip with friends under ₹6000",
    preferences: {
      trip_type: "friends",
      amenities: ["swimming_pool", "free_wifi"],
      experience: ["nightlife"]
    }
  },
  {
    label: "Manali couple luxury",
    query: "Couple stay in Manali with mountain views",
    preferences: {
      trip_type: "couple",
      amenities: ["jacuzzi", "spa"],
      experience: ["luxury", "peaceful"]
    }
  }
];

const LABELS = new Map(
  [...FILTER_OPTIONS.amenities, ...FILTER_OPTIONS.tripType, ...FILTER_OPTIONS.experience].map((option) => [
    option.value,
    option.label
  ])
);

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function createEmptyPreferences() {
  return {
    trip_type: "",
    amenities: [],
    experience: []
  };
}

function createInitialState() {
  const seed = EXAMPLE_SEARCHES[0];
  return {
    query: seed.query,
    preferences: { ...createEmptyPreferences(), ...seed.preferences }
  };
}

function humanize(value) {
  if (!value) return "";
  if (LABELS.has(value)) return LABELS.get(value);
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCurrency(value) {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function getProviderName(link) {
  try {
    const host = new URL(link).hostname.replace("www.", "");
    if (host.includes("booking")) return "Booking.com";
    if (host.includes("agoda")) return "Agoda";
    if (host.includes("makemytrip")) return "MakeMyTrip";
    return host;
  } catch {
    return "Booking Partner";
  }
}

function buildSelectedFilterChips(preferences) {
  const chips = [];

  if (preferences.trip_type) {
    chips.push({ key: `trip-${preferences.trip_type}`, label: `Trip Type: ${humanize(preferences.trip_type)}` });
  }

  preferences.amenities.forEach((amenity) => {
    chips.push({ key: `amenity-${amenity}`, label: humanize(amenity) });
  });

  preferences.experience.forEach((experience) => {
    chips.push({ key: `experience-${experience}`, label: humanize(experience) });
  });

  return chips;
}

function buildIntentChips(result) {
  const chips = [];

  if (result.intent?.location) {
    chips.push(`Location: ${result.intent.location}`);
  }

  if (result.intent?.budgetPerNight) {
    chips.push(`Budget: ${formatCurrency(result.intent.budgetPerNight)}/night`);
  }

  if (result.intent?.tripType && result.intent.tripType !== "unknown") {
    chips.push(`Detected Trip: ${humanize(result.intent.tripType)}`);
  }

  (result.intent?.amenitySignals || []).forEach((value) => {
    chips.push(`Signal: ${humanize(value)}`);
  });

  return chips;
}

function App() {
  const [formState, setFormState] = useState(createInitialState);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedHotelId, setExpandedHotelId] = useState("");
  const [refineIndex, setRefineIndex] = useState(0);

  const selectedFilterChips = useMemo(
    () => buildSelectedFilterChips(formState.preferences),
    [formState.preferences]
  );

  async function runSearch(nextState, nextRefineIndex = 0) {
    const safeState = nextState || formState;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: String(safeState.query || "").trim(),
          preferences: safeState.preferences
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Search failed");
      }

      setResult(payload);
      setExpandedHotelId(payload.hotels?.[0]?.id || "");
      setRefineIndex(nextRefineIndex);
    } catch (searchError) {
      setResult(null);
      setError(searchError instanceof Error ? searchError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function setQuery(query) {
    setFormState((current) => ({
      ...current,
      query
    }));
  }

  function toggleMulti(field, value) {
    setFormState((current) => {
      const currentValues = current.preferences[field];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...current,
        preferences: {
          ...current.preferences,
          [field]: nextValues
        }
      };
    });
  }

  function setTripType(value) {
    setFormState((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        trip_type: current.preferences.trip_type === value ? "" : value
      }
    }));
  }

  function clearAll() {
    setFormState((current) => ({
      ...current,
      preferences: createEmptyPreferences()
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    runSearch(formState, 0);
  }

  function handleExample(example) {
    const nextState = {
      query: example.query,
      preferences: { ...createEmptyPreferences(), ...example.preferences }
    };

    setFormState(nextState);
    runSearch(nextState, 0);
  }

  function handleRefine() {
    if (!result?.refinementSuggestions?.length) return;

    const nextRefineIndex = refineIndex + 1;
    const suggestion =
      result.refinementSuggestions[nextRefineIndex % result.refinementSuggestions.length];
    const nextState = {
      ...formState,
      query: `${formState.query.trim()}. Refine this search and ${suggestion}.`
    };

    setFormState(nextState);
    runSearch(nextState, nextRefineIndex);
  }

  const activeRefinement =
    result?.refinementSuggestions?.[refineIndex % Math.max(result?.refinementSuggestions?.length || 1, 1)] || "";

  return e(
    "div",
    { className: "min-h-screen bg-transparent" },
    e(
      "div",
      { className: "mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8" },
      e(HeroSection),
      e(SearchPanel, {
        formState,
        loading,
        onQueryChange: setQuery,
        onSubmit: handleSubmit,
        onToggleMulti: toggleMulti,
        onSetTripType: setTripType,
        onClearAll: clearAll,
        onExample: handleExample,
        selectedFilterChips
      }),
      selectedFilterChips.length
        ? e(SelectedFiltersPanel, { chips: selectedFilterChips })
        : null,
      loading ? e(LoadingState) : null,
      !loading && error ? e(ErrorState, { error }) : null,
      !loading && result
        ? e(
            Fragment,
            null,
            e(ResultSummary, { result }),
            e(IntentPanel, { chips: buildIntentChips(result) }),
            e(ResultsSection, {
              result,
              expandedHotelId,
              onToggleDetails: (hotelId) =>
                setExpandedHotelId((current) => (current === hotelId ? "" : hotelId))
            }),
            activeRefinement
              ? e(RefinePanel, {
                  suggestion: activeRefinement,
                  onRefine: handleRefine
                })
              : null
          )
        : null
    )
  );
}

function HeroSection() {
  return e(
    "section",
    { className: "grid gap-6 lg:grid-cols-[1.2fr_0.8fr]" },
    e(
      "div",
      { className: "rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
      e(
        "div",
        { className: "mb-4 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700" },
        "AI Hotel Discovery Agent"
      ),
      e(
        "h1",
        { className: "max-w-3xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl" },
        "Discover hotels with booking-ready cards, smart search, and clear recommendation logic."
      ),
      e(
        "p",
        { className: "mt-4 max-w-2xl text-base leading-7 text-stone-600" },
        "Use natural language plus curated filters, then browse polished hotel cards with images, explanations, and direct booking links."
      )
    ),
    e(
      "div",
      { className: "grid gap-4" },
      statCard("Catalog", "20 local hotels across Jaipur, Delhi, Goa, and Manali with images, ratings, and booking links."),
      statCard("Ranking", "3-layer fallback: strict same-city matches, smart relaxed alternatives, then top-rated city picks."),
      statCard("Trust", "The engine always returns 5 hotels, keeps your city fixed, and explains why each result is shown.")
    )
  );
}

function statCard(title, body) {
  return e(
    "div",
    { className: "rounded-[1.75rem] border border-white/60 bg-white/70 p-5 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e("div", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, title),
    e("p", { className: "mt-2 text-sm leading-6 text-stone-700" }, body)
  );
}

function SearchPanel({
  formState,
  loading,
  onQueryChange,
  onSubmit,
  onToggleMulti,
  onSetTripType,
  onClearAll,
  onExample,
  selectedFilterChips
}) {
  return e(
    "section",
    { className: "mt-8 rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur sm:p-8" },
    e(
      "form",
      { className: "space-y-6", onSubmit },
      e(
        "div",
        { className: "space-y-3" },
        e(
          "label",
          { className: "text-sm font-medium text-stone-700", htmlFor: "query" },
          "Describe the stay you want"
        ),
        e("textarea", {
          id: "query",
          rows: 3,
          value: formState.query,
          placeholder: "Family trip in Jaipur under ₹5000 with a pool",
          className:
            "w-full rounded-[1.5rem] border border-stone-200 bg-stone-50 px-5 py-4 text-base text-stone-900 shadow-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100",
          onChange: (event) => onQueryChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit(event);
            }
          }
        })
      ),
      e(
        "div",
        { className: "grid gap-5 lg:grid-cols-3" },
        e(FilterGroup, {
          title: "Amenities",
          options: FILTER_OPTIONS.amenities,
          selectedValues: formState.preferences.amenities,
          onToggle: (value) => onToggleMulti("amenities", value)
        }),
        e(FilterGroup, {
          title: "Trip Type",
          options: FILTER_OPTIONS.tripType,
          selectedValues: formState.preferences.trip_type ? [formState.preferences.trip_type] : [],
          onToggle: onSetTripType,
          single: true
        }),
        e(FilterGroup, {
          title: "Experience Type",
          options: FILTER_OPTIONS.experience,
          selectedValues: formState.preferences.experience,
          onToggle: (value) => onToggleMulti("experience", value)
        })
      ),
      e(
        "div",
        { className: "flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between" },
        e(
          "div",
          { className: "flex flex-wrap gap-3" },
          EXAMPLE_SEARCHES.map((example) =>
            e(
              "button",
              {
                key: example.label,
                type: "button",
                className:
                  "rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800",
                onClick: () => onExample(example)
              },
              example.label
            )
          )
        ),
        e(
          "div",
          { className: "flex flex-wrap items-center gap-3" },
          e(
            "button",
            {
              type: "button",
              disabled: !selectedFilterChips.length,
              className:
                "rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50",
              onClick: onClearAll
            },
            "Clear All"
          ),
          e(
            "button",
            {
              type: "submit",
              disabled: loading,
              className:
                "rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-stone-900/10 transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
            },
            loading ? "Searching..." : "Find Hotels"
          )
        )
      )
    )
  );
}

function FilterGroup({ title, options, selectedValues, onToggle }) {
  return e(
    "div",
    { className: "rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-4" },
    e("div", { className: "mb-3 text-sm font-semibold text-stone-800" }, title),
    e(
      "div",
      { className: "flex flex-wrap gap-2" },
      options.map((option) =>
        e(
          "button",
          {
            key: option.value,
            type: "button",
            onClick: () => onToggle(option.value),
            className: cx(
              "rounded-full border px-3 py-2 text-sm font-medium transition",
              selectedValues.includes(option.value)
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-stone-200 bg-white text-stone-700 hover:border-amber-200 hover:bg-amber-50"
            )
          },
          option.label
        )
      )
    )
  );
}

function SelectedFiltersPanel({ chips }) {
  return e(
    "section",
    { className: "mt-6 rounded-[1.75rem] border border-white/60 bg-white/70 p-5 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e("div", { className: "text-sm font-semibold text-stone-800" }, "Selected Filters"),
    e(
      "div",
      { className: "mt-3 flex flex-wrap gap-2" },
      chips.map((chip) =>
        e(
          "span",
          {
            key: chip.key,
            className: "rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold tracking-wide text-white"
          },
          chip.label
        )
      )
    )
  );
}

function LoadingState() {
  return e(
    "section",
    { className: "mt-8 space-y-5" },
    e(
      "div",
      { className: "rounded-[1.75rem] border border-white/60 bg-white/75 p-5 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
      e("div", { className: "h-5 w-56 animate-pulse rounded-full bg-stone-200" }),
      e("div", { className: "mt-3 h-4 w-72 animate-pulse rounded-full bg-stone-100" })
    ),
    e(
      "div",
      { className: "grid gap-6 lg:grid-cols-3" },
      [0, 1, 2, 3, 4].map((index) =>
        e(
          "div",
          {
            key: index,
            className: "overflow-hidden rounded-[2rem] border border-white/60 bg-white/75 p-4 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur"
          },
          e("div", { className: "h-52 animate-pulse rounded-[1.5rem] bg-stone-200" }),
          e("div", { className: "mt-4 h-5 w-40 animate-pulse rounded-full bg-stone-200" }),
          e("div", { className: "mt-3 h-4 w-24 animate-pulse rounded-full bg-stone-100" }),
          e("div", { className: "mt-6 h-10 animate-pulse rounded-2xl bg-stone-100" })
        )
      )
    )
  );
}

function ErrorState({ error }) {
  return e(
    "section",
    { className: "mt-8 rounded-[1.75rem] border border-rose-200 bg-rose-50 p-5 text-rose-800" },
    e("div", { className: "text-sm font-semibold uppercase tracking-[0.18em]" }, "Search Error"),
    e("p", { className: "mt-2 text-sm leading-6" }, error)
  );
}

function ResultSummary({ result }) {
  return e(
    "section",
    { className: "mt-8 rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e(
      "div",
      { className: "flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between" },
      e(
        "div",
        null,
        e("div", { className: "text-sm font-semibold uppercase tracking-[0.18em] text-stone-500" }, "Search Summary"),
        e("h2", { className: "mt-2 text-2xl font-semibold text-stone-900" }, "Top Hotel Picks"),
        e("p", { className: "mt-3 max-w-3xl text-sm leading-7 text-stone-600" }, result.summary)
      ),
      e(
        "div",
        { className: "grid min-w-[220px] gap-3 rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4" },
        summaryStat("Confidence", `${result.confidence}%`),
        summaryStat("Mode", result.meta?.aiMode === "openai" ? "OpenAI assisted" : "Local scoring"),
        summaryStat("Catalog Scope", result.locationStatus?.label || "All cities"),
        summaryStat(
          "Fallback Mix",
          `${result.meta?.layerCounts?.strict || 0}/${result.meta?.layerCounts?.relaxed || 0}/${result.meta?.layerCounts?.fallback || 0}`
        )
      )
    )
  );
}

function summaryStat(label, value) {
  return e(
    "div",
    { className: "flex items-center justify-between gap-4" },
    e("span", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, label),
    e("span", { className: "text-sm font-semibold text-stone-800" }, value)
  );
}

function IntentPanel({ chips }) {
  if (!chips.length) return null;

  return e(
    "section",
    { className: "mt-6 rounded-[1.75rem] border border-white/60 bg-white/75 p-5 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e("div", { className: "text-sm font-semibold text-stone-800" }, "Detected Intent"),
    e(
      "div",
      { className: "mt-3 flex flex-wrap gap-2" },
      chips.map((chip) =>
        e(
          "span",
          {
            key: chip,
            className: "rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700"
          },
          chip
        )
      )
    )
  );
}

function ResultsSection({ result, expandedHotelId, onToggleDetails }) {
  if (!result.hotels.length) {
    return e(
      "section",
      { className: "mt-8 rounded-[2rem] border border-white/60 bg-white/75 p-8 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
      e("div", { className: "text-sm font-semibold uppercase tracking-[0.18em] text-stone-500" }, "No Exact Matches"),
      e("h2", { className: "mt-2 text-2xl font-semibold text-stone-900" }, "No hotels found"),
      e("p", { className: "mt-3 max-w-2xl text-sm leading-7 text-stone-600" }, result.summary)
    );
  }

  return e(
    "section",
    { className: "mt-8" },
    e(
      "div",
      { className: "mb-5 flex items-center justify-between gap-4" },
      e("h2", { className: "text-2xl font-semibold text-stone-900" }, "Booking-Ready Hotels"),
      e("div", { className: "text-sm text-stone-500" }, `${result.hotels.length} results`)
    ),
    e(
      "div",
      { className: "grid gap-6 lg:grid-cols-2 xl:grid-cols-3" },
      result.hotels.map((hotel) =>
        e(HotelCard, {
          key: hotel.id,
          hotel,
          expanded: expandedHotelId === hotel.id,
          onToggleDetails
        })
      )
    )
  );
}

function HotelCard({ hotel, expanded, onToggleDetails }) {
  return e(
    "article",
    { className: "overflow-hidden rounded-[2rem] border border-white/60 bg-white/80 p-4 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e(
      "div",
      { className: "relative" },
      e("img", {
        src: hotel.image,
        alt: `${hotel.name} in ${hotel.city}`,
        className: "h-52 w-full rounded-[1.5rem] object-cover"
      }),
      e(
        "div",
        { className: "absolute left-4 top-4 flex flex-wrap gap-2" },
        [hotel.matchLabel, hotel.fallbackBadge].filter(Boolean).map((label) =>
          e(
            "span",
            {
              key: label,
              className: cx(
                "rounded-full px-3 py-1 text-xs font-semibold shadow",
                label === hotel.matchLabel
                  ? "bg-white/90 text-stone-900"
                  : "bg-amber-500 text-stone-950"
              )
            },
            label
          )
        )
      )
    ),
    e(
      "div",
      { className: "mt-5 flex items-start justify-between gap-4" },
      e(
        "div",
        null,
        e("h3", { className: "text-xl font-semibold text-stone-900" }, hotel.name),
        e("p", { className: "mt-1 text-sm text-stone-500" }, `${hotel.area}, ${hotel.city}`)
      ),
      e(
        "div",
        { className: "rounded-full bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white" },
        `${hotel.matchScore}% match`
      )
    ),
    e(
      "div",
      { className: "mt-4 flex items-center justify-between gap-4 rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3" },
      e(
        "div",
        null,
        e("div", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, "Price"),
        e("div", { className: "mt-1 text-lg font-semibold text-stone-900" }, `${formatCurrency(hotel.price)} / night`)
      ),
      e(
        "div",
        { className: "text-right" },
        e("div", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, "Rating"),
        e("div", { className: "mt-1 text-lg font-semibold text-stone-900" }, `${hotel.rating.toFixed(1)} / 5`)
      )
    ),
    e(
      "div",
      { className: "mt-4 flex flex-wrap gap-2" },
      hotel.highlights.map((highlight) =>
        e(
          "span",
          {
            key: highlight,
            className: "rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
          },
          highlight
        )
      )
    ),
    e(
      "p",
      { className: "mt-4 text-sm leading-7 text-stone-600" },
      hotel.explanation
    ),
    expanded
      ? e(
          "div",
          { className: "mt-5 rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4" },
          e("p", { className: "text-sm leading-7 text-stone-600" }, hotel.description),
          e(
            "div",
            { className: "mt-4" },
            e("div", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, "Amenities"),
            e(
              "div",
              { className: "mt-2 flex flex-wrap gap-2" },
              hotel.amenities.map((amenity) =>
                e(
                  "span",
                  {
                    key: amenity,
                    className: "rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700"
                  },
                  humanize(amenity)
                )
              )
            )
          ),
          e(
            "div",
            { className: "mt-4 grid grid-cols-2 gap-3 text-sm text-stone-600" },
            detailStat("Location", `${hotel.scoreBreakdown.location}%`),
            detailStat("Budget", `${hotel.scoreBreakdown.budget}%`),
            detailStat("Amenities", `${hotel.scoreBreakdown.amenities}%`),
            detailStat("Trip Type", `${hotel.scoreBreakdown.tripType}%`)
          )
        )
      : null,
    e(
      "div",
      { className: "mt-5 flex flex-wrap gap-3" },
      e(
        "button",
        {
          type: "button",
          className:
            "flex-1 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-300 hover:bg-stone-50",
          onClick: () => onToggleDetails(hotel.id)
        },
        expanded ? "Hide Details" : "View Details"
      ),
      e(
        "a",
        {
          href: hotel.booking_link,
          target: "_blank",
          rel: "noreferrer",
          className:
            "flex-1 rounded-full bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-stone-950 transition hover:bg-amber-400"
        },
        `Book Now on ${getProviderName(hotel.booking_link)}`
      )
    )
  );
}

function detailStat(label, value) {
  return e(
    "div",
    { className: "rounded-2xl bg-white px-3 py-3" },
    e("div", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" }, label),
    e("div", { className: "mt-1 font-semibold text-stone-900" }, value)
  );
}

function RefinePanel({ suggestion, onRefine }) {
  return e(
    "section",
    { className: "mt-8 rounded-[1.75rem] border border-white/60 bg-white/75 p-5 shadow-[0_20px_80px_rgba(28,25,23,0.08)] backdrop-blur" },
    e(
      "div",
      { className: "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" },
      e(
        "div",
        null,
        e("div", { className: "text-sm font-semibold text-stone-800" }, "Refine Results"),
        e(
          "p",
          { className: "mt-1 text-sm leading-7 text-stone-600" },
          "Need a second pass? Try refining around ",
          e("strong", { className: "text-stone-900" }, suggestion),
          "."
        )
      ),
      e(
        "button",
        {
          type: "button",
          onClick: onRefine,
          className:
            "rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-300 hover:bg-stone-50"
        },
        "Refine Results"
      )
    )
  );
}

root.render(e(App));
