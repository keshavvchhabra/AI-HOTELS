const { useMemo, useState, useEffect, useRef } = React;
const root = ReactDOM.createRoot(document.getElementById("root"));
const e = React.createElement;
const Fragment = React.Fragment;

const FILTER_OPTIONS = {
  amenities: [
    { label: "Jacuzzi", value: "jacuzzi" },
    { label: "Bathtub", value: "bathtub" },
    { label: "Pool", value: "swimming_pool" },
    { label: "Spa", value: "spa" },
    { label: "Gym", value: "gym" },
    { label: "Free WiFi", value: "free_wifi" },
    { label: "Parking", value: "parking" },
    { label: "Breakfast", value: "breakfast_included" },
    { label: "AC", value: "air_conditioning" }
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

const EXAMPLES = [
  { label: "Jaipur family", query: "Family trip in Jaipur under ₹5000", preferences: { trip_type: "family", amenities: ["swimming_pool", "free_wifi"], experience: ["budget", "cultural"] } },
  { label: "Goa with friends", query: "Goa trip with friends under ₹6000", preferences: { trip_type: "friends", amenities: ["swimming_pool", "free_wifi"], experience: ["nightlife"] } },
  { label: "Manali luxury couple", query: "Couple stay in Manali with mountain views", preferences: { trip_type: "couple", amenities: ["jacuzzi", "spa"], experience: ["luxury", "peaceful"] } },
  { label: "Delhi business", query: "Business hotel in Delhi with good wifi", preferences: { trip_type: "solo", amenities: ["free_wifi", "gym"], experience: ["work_friendly"] } },
  { label: "Kolkata budget", query: "Budget hotels in Kolkata", preferences: { trip_type: "family", amenities: [], experience: ["budget"] } },
];

const LABELS = new Map(
  [...FILTER_OPTIONS.amenities, ...FILTER_OPTIONS.tripType, ...FILTER_OPTIONS.experience].map(o => [o.value, o.label])
);

function cx(...parts) { return parts.filter(Boolean).join(" "); }
function emptyPrefs() { return { trip_type: "", amenities: [], experience: [] }; }
function initState() {
  return { query: "Family trip in Jaipur under ₹5000", preferences: { trip_type: "family", amenities: ["swimming_pool", "free_wifi"], experience: ["budget", "cultural"] } };
}
function humanize(v) {
  if (!v) return "";
  if (LABELS.has(v)) return LABELS.get(v);
  return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function currency(n) { return `₹${Number(n).toLocaleString("en-IN")}`; }
function providerName(link) {
  try {
    const h = new URL(link).hostname.replace("www.", "");
    if (h.includes("booking")) return "Booking.com";
    if (h.includes("agoda")) return "Agoda";
    if (h.includes("makemytrip")) return "MakeMyTrip";
    if (h.includes("tripadvisor")) return "TripAdvisor";
    return "Book Now";
  } catch { return "Book Now"; }
}

function starRating(rating) {
  return Array.from({ length: 5 }, (_, i) =>
    e("span", { key: i, className: cx("hcard-star", i >= Math.round(rating) && "empty") }, "★")
  );
}

/* ── scroll reveal hook ── */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.classList.add("in"); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("in"); obs.disconnect(); } },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function Reveal({ delay, className, children, as = "div" }) {
  const ref = useReveal();
  return e(as, { ref, className: cx("reveal", delay && `reveal-d${delay}`, className) }, children);
}

/* ── flipping word ── */
function WordFlip({ words, interval = 2600 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(p => (p + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [words, interval]);
  return e("span", { className: "flip-word" },
    e("span", { className: "flip-track", "data-i": i },
      words.map((w, idx) => e("em", { key: w, className: cx("flip-item", idx === i && "on") }, w))
    )
  );
}

/* ── preloader ── */
function Preloader() {
  const [hide, setHide] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setHide(true), 1500);
    const t2 = setTimeout(() => setGone(true), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (gone) return null;
  return e("div", { className: cx("preloader", hide && "out") },
    e("div", { className: "pre-mark" },
      e("span", { className: "pre-word" }, "Stay", e("em", null, "Finder")),
      e("span", { className: "pre-bar" }, e("span", { className: "pre-bar-fill" }))
    )
  );
}

/* ────────── APP ────────── */
function App() {
  const [form, setForm] = useState(initState);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState("");
  const [refineIdx, setRefineIdx] = useState(0);

  const filterChips = useMemo(() => {
    const chips = [];
    if (form.preferences.trip_type) chips.push({ key: "tt", label: `Trip: ${humanize(form.preferences.trip_type)}` });
    form.preferences.amenities.forEach(a => chips.push({ key: a, label: humanize(a) }));
    form.preferences.experience.forEach(x => chips.push({ key: x, label: humanize(x) }));
    return chips;
  }, [form.preferences]);

  async function search(s, ri = 0) {
    setLoading(true); setError("");
    try {
      const resp = await fetch("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: String(s.query || "").trim(), preferences: s.preferences })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Search failed");
      setResult(data);
      setExpanded(data.hotels?.[0]?.id || "");
      setRefineIdx(ri);
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    } catch (err) {
      setResult(null); setError(err.message || "Unknown error");
    } finally { setLoading(false); }
  }

  function handleSubmit(ev) { ev.preventDefault(); search(form, 0); }
  function handleExample(ex) {
    const next = { query: ex.query, preferences: { ...emptyPrefs(), ...ex.preferences } };
    setForm(next); search(next, 0);
  }
  function handleRefine() {
    if (!result?.refinementSuggestions?.length) return;
    const idx = refineIdx + 1;
    const sug = result.refinementSuggestions[idx % result.refinementSuggestions.length];
    const next = { ...form, query: `${form.query.trim()}. ${sug}` };
    setForm(next); search(next, idx);
  }
  function toggleMulti(field, val) {
    setForm(c => {
      const cur = c.preferences[field];
      return { ...c, preferences: { ...c.preferences, [field]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] } };
    });
  }
  function setTripType(val) {
    setForm(c => ({ ...c, preferences: { ...c.preferences, trip_type: c.preferences.trip_type === val ? "" : val } }));
  }
  function clearAll() { setForm(c => ({ ...c, preferences: emptyPrefs() })); }

  const intentChips = result ? [
    result.intent?.location && result.intent.location,
    result.intent?.budgetPerNight && `${currency(result.intent.budgetPerNight)} / night`,
    result.intent?.tripType && result.intent.tripType !== "unknown" && humanize(result.intent.tripType),
    ...(result.intent?.amenitySignals || []).map(v => humanize(v))
  ].filter(Boolean) : [];

  const activeRefinement = result?.refinementSuggestions?.[refineIdx % Math.max(result?.refinementSuggestions?.length || 1, 1)] || "";

  return e(Fragment, null,
    e(Preloader),
    /* NAV */
    e("nav", { className: "nav" },
      e("div", { className: "nav-inner" },
        e("button", { type: "button", className: "nav-brand", onClick: () => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => location.reload(), 300); }, "aria-label": "StayFinder home" },
          e("span", { className: "nav-logo" }, "Stay", e("em", null, "Finder")),
          e("span", { className: "nav-name" }, "Hotel Discovery")
        ),
        e("div", { className: "nav-right" },
          e("span", { className: "nav-stat" }, e("b", null, "Live"), " · TripAdvisor"),
          e("span", { className: "nav-stat" }, e("b", null, "AI"), " · Smart Match"),
          e("span", { className: "nav-badge" }, "Beta")
        )
      )
    ),

    /* HERO */
    e("section", { className: "hero" },
      e("div", { className: "hero-inner" },
        e(Reveal, { className: "hero-eyebrow", as: "div" }, "Curated Stays · Across India"),
        e(Reveal, { delay: 1, className: "hero-title", as: "h1" },
          "Find your ", e(WordFlip, { words: ["perfect", "peaceful", "serene", "luxurious", "boutique"] }), " stay,", e("br", null), "wherever you wander."
        ),
        e(Reveal, { delay: 2, className: "hero-sub", as: "div" },
          e("span", { className: "hero-sub-line" }, "Live prices from TripAdvisor, across every Indian city."),
          e("span", { className: "hero-sub-divider" }),
          e("span", { className: "hero-sub-line" }, "Refined by AI · ", e("em", null, "presented with care"), ".")
        )
      ),
    ),

    /* SEARCH */
    e("div", { className: "search-wrap" },
      e(Reveal, { className: "search-card" },
        e("form", { onSubmit: handleSubmit },
          e("div", { className: "search-head" },
            e("div", { className: "search-card-eyebrow" }, "Begin your search"),
            e("div", { className: "search-card-title" }, "Tell us about your ", e("em", null, "perfect"), " stay")
          ),
          e("div", { className: "search-box" },
            e("textarea", {
              className: "search-textarea", rows: 2,
              value: form.query,
              placeholder: "e.g. A peaceful family stay in Udaipur with a pool, under ₹6000…",
              onChange: ev => setForm(c => ({ ...c, query: ev.target.value })),
              onKeyDown: ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); handleSubmit(ev); } }
            }),
            e("button", { type: "submit", disabled: loading, className: "btn-search" },
              loading ? "Searching" : "Search"
            )
          ),

          e("div", { className: "filter-row" },
            filterGroup("Amenities", FILTER_OPTIONS.amenities, form.preferences.amenities, v => toggleMulti("amenities", v)),
            filterGroup("Trip Type", FILTER_OPTIONS.tripType, form.preferences.trip_type ? [form.preferences.trip_type] : [], setTripType),
            filterGroup("Experience", FILTER_OPTIONS.experience, form.preferences.experience, v => toggleMulti("experience", v))
          ),

          e("div", { className: "action-bar" },
            e("div", { className: "quick-btns" },
              e("span", { className: "quick-label" }, "Try"),
              EXAMPLES.map(ex => e("button", { key: ex.label, type: "button", className: "btn-quick", onClick: () => handleExample(ex) }, ex.label))
            ),
            e("button", { type: "button", className: "btn-clear", disabled: !filterChips.length, onClick: clearAll }, "Clear filters")
          )
        )
      )
    ),

    /* STATS BAND */
    e("section", { className: "stats-band" },
      e(Reveal, { className: "section-head" },
        e("div", { className: "section-eyebrow" }, "Why StayFinder"),
        e("h2", { className: "section-title" }, "Hotels, ", e("em", null, "thoughtfully"), " curated"),
        e("p", { className: "section-sub" }, "We blend live inventory with intelligent matching so every recommendation feels handpicked.")
      ),
      e(Reveal, { delay: 1, className: "stats-grid" },
        heroStat("∞", "Hotels worldwide"),
        heroStat("18+", "Indian cities"),
        heroStat("Live", "TripAdvisor prices"),
        heroStat("AI", "Smart matching")
      )
    ),

    /* MAIN */
    e("div", { className: "main", id: "results" },
      filterChips.length ? e(Reveal, { className: "tag-bar" },
        e("span", { className: "tag-bar-label" }, "Active filters"),
        ...filterChips.map(c => e("span", { key: c.key, className: "tag-pill" }, c.label))
      ) : null,

      loading ? e(LoadingSkeleton) : null,
      !loading && error ? e("div", { className: "error-box" },
        e("div", null, e("div", { className: "error-title" }, "Search Error"), e("p", { className: "error-msg" }, error))
      ) : null,

      !loading && result ? e(Fragment, null,
        result.intent?.location ? e(Reveal, { className: "city-banner" },
          e("img", {
            className: "city-banner-img",
            src: `https://picsum.photos/seed/${encodeURIComponent(result.intent.location.toLowerCase())}-city/1600/600`,
            alt: result.intent.location
          }),
          e("div", { className: "city-banner-inner" },
            e("div", { className: "city-banner-eyebrow" }, "Discover"),
            e("h2", { className: "city-banner-title" }, "Stays in ", e("em", null, result.intent.location)),
            e("div", { className: "city-banner-meta" },
              e("span", null, `${result.hotels.length} curated matches`),
              e("span", { className: "dot" }),
              e("span", null, result.meta?.totalHotels > 20 ? "Live TripAdvisor inventory" : "Editorial selection"),
              e("span", { className: "dot" }),
              e("span", null, `${result.confidence}% match confidence`)
            )
          )
        ) : null,

        intentChips.length ? e(Reveal, { className: "tag-bar intent" },
          e("span", { className: "tag-bar-label" }, "Detected"),
          ...intentChips.map(c => e("span", { key: c, className: "tag-pill" }, c))
        ) : null,

        e(Reveal, { className: "result-bar" },
          e("div", null,
            e("div", { className: "result-eyebrow" }, "Curated for you"),
            e("div", { className: "result-title" }, "Top matches"),
            e("p", { className: "result-summary-text" }, result.summary)
          ),
          e("div", { className: "result-meta" },
            metaCell("Confidence", `${result.confidence}%`),
            metaCell("Mode", result.meta?.aiMode === "openai" ? "AI" : "Local"),
            metaCell("Source", result.meta?.totalHotels > 20 ? "TripAdvisor" : "Catalog"),
            metaCell("Layers", `${result.meta?.layerCounts?.strict || 0}/${result.meta?.layerCounts?.relaxed || 0}/${result.meta?.layerCounts?.fallback || 0}`)
          )
        ),

        result.hotels.length === 0
          ? e("div", { className: "error-box" },
              e("div", null,
                e("div", { className: "error-title" }, "No hotels found"),
                e("p", { className: "error-msg" }, result.summary)
              )
            )
          : e(Fragment, null,
              e(Reveal, { className: "results-hd" },
                e("span", { className: "results-hd-title" }, "Available ", e("em", null, "hotels")),
                e("span", { className: "results-count" }, `${result.hotels.length} results`)
              ),
              e("div", { className: "hotel-grid" },
                result.hotels.map((h, i) => e(RevealCard, {
                  key: h.id, index: i, hotel: h,
                  isExpanded: expanded === h.id,
                  onToggle: () => setExpanded(c => c === h.id ? "" : h.id)
                }))
              )
            ),

        activeRefinement ? e(Reveal, { className: "refine-bar" },
          e("div", null,
            e("div", { style: { fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.55)", textTransform: "uppercase", letterSpacing: ".22em", marginBottom: 6 } }, "Refine search"),
            e("p", { className: "refine-text" }, "Try narrowing around ", e("strong", null, activeRefinement), ".")
          ),
          e("button", { className: "btn-refine", onClick: handleRefine }, "Refine")
        ) : null
      ) : null
    ),

    /* FOOTER */
    e(Footer)
  );
}

function Footer() {
  const ref = useReveal();
  const year = new Date().getFullYear();
  return e("footer", { ref, className: "reveal footer" },
    e("div", { className: "footer-inner" },
      e("div", { className: "footer-brand-block" },
        e("div", { className: "footer-logo" }, "Stay", e("em", null, "Finder")),
        e("p", { className: "footer-tagline" }, "Hotels, thoughtfully curated. Live prices, refined by intelligent matching."),
        e("div", { className: "footer-meta" }, "Made for travellers · India")
      ),
      e("div", null,
        e("div", { className: "footer-col-title" }, "Discover"),
        e("ul", { className: "footer-list" },
          ["Goa", "Jaipur", "Manali", "Udaipur", "Kolkata", "Kerala"].map(c =>
            e("li", { key: c }, e("a", { href: "#", onClick: ev => ev.preventDefault() }, c))
          )
        )
      ),
      e("div", null,
        e("div", { className: "footer-col-title" }, "Company"),
        e("ul", { className: "footer-list" },
          ["About", "How it works", "Press", "Contact"].map(c =>
            e("li", { key: c }, e("a", { href: "#", onClick: ev => ev.preventDefault() }, c))
          )
        )
      ),
      e("div", null,
        e("div", { className: "footer-col-title" }, "Resources"),
        e("ul", { className: "footer-list" },
          ["Privacy", "Terms", "Trust & safety", "Help centre"].map(c =>
            e("li", { key: c }, e("a", { href: "#", onClick: ev => ev.preventDefault() }, c))
          )
        )
      )
    ),
    e("div", { className: "footer-bottom" },
      e("span", null, `© ${year} StayFinder. All rights reserved.`),
      e("span", null, "Crafted with ", e("em", null, "care"), " · Powered by TripAdvisor")
    )
  );
}

function filterGroup(title, options, selected, onToggle) {
  return e("div", { className: "filter-group" },
    e("div", { className: "filter-group-title" }, title),
    e("div", { className: "chip-row" },
      options.map(opt => e("button", {
        key: opt.value, type: "button",
        className: cx("chip", selected.includes(opt.value) && "on"),
        onClick: () => onToggle(opt.value)
      }, opt.label))
    )
  );
}

function heroStat(num, label) {
  return e("div", { className: "hero-stat" },
    e("div", { className: "hero-stat-num" }, num),
    e("div", { className: "hero-stat-lbl" }, label)
  );
}

function metaCell(label, val) {
  return e("div", { className: "meta-cell" },
    e("div", { className: "meta-cell-label" }, label),
    e("div", { className: "meta-cell-value" }, val)
  );
}

function RevealCard(props) {
  const ref = useReveal();
  const delay = (props.index % 3) + 1;
  return e("div", { ref, className: cx("reveal", `reveal-d${delay}`) }, e(HotelCard, props));
}

/* ────────── HOTEL CARD ────────── */
function HotelCard({ hotel, isExpanded, onToggle }) {
  const stars = starRating(hotel.rating);

  return e("article", { className: "hcard" },
    e("div", { className: "hcard-img-wrap" },
      e("img", { className: "hcard-img", src: hotel.image, alt: hotel.name, loading: "lazy" }),
      e("div", { className: "hcard-badges" },
        hotel.matchLabel ? e("span", { className: "badge-match" }, hotel.matchLabel) : null,
        hotel.fallbackBadge ? e("span", { className: "badge-alt" }, hotel.fallbackBadge) : null
      ),
      e("span", { className: "badge-score" }, `${hotel.matchScore}% match`),
      hotel.rating >= 4.5 ? e("span", { className: "badge-tc" }, "Traveller's Choice") : null
    ),

    e("div", { className: "hcard-body" },
      e("h3", { className: "hcard-name" }, hotel.name),
      e("p", { className: "hcard-loc" }, `${hotel.area}, ${hotel.city}`),

      e("div", { className: "hcard-pr" },
        e("div", null,
          e("div", { className: "hcard-price-label" }, "From"),
          e("div", null,
            e("span", { className: "hcard-price" }, currency(hotel.price)),
            e("span", { className: "hcard-price-night" }, "/night")
          )
        ),
        e("div", { className: "hcard-rating" },
          e("div", { className: "hcard-stars" }, ...stars),
          e("div", { className: "hcard-rating-num" }, `${hotel.rating.toFixed(1)} `, e("span", { className: "hcard-rating-count" }, "/ 5.0"))
        )
      ),

      e("div", { className: "hcard-tags" },
        hotel.highlights.map(h => e("span", { key: h, className: "hcard-tag" }, h))
      ),

      e("p", { className: "hcard-expl" }, "“", hotel.explanation, "”"),

      isExpanded ? e("div", { className: "hcard-details" },
        e("p", { className: "hcard-details-desc" }, hotel.description),
        e("div", { className: "det-label" }, "Amenities"),
        e("div", { className: "amenity-row" },
          hotel.amenities.map(a => e("span", { key: a, className: "amenity-pill" }, humanize(a)))
        ),
        e("div", { className: "det-label" }, "Score breakdown"),
        e("div", { className: "score-grid" },
          scoreCell("Location", `${hotel.scoreBreakdown.location}%`),
          scoreCell("Budget", `${hotel.scoreBreakdown.budget}%`),
          scoreCell("Amenities", `${hotel.scoreBreakdown.amenities}%`),
          scoreCell("Trip type", `${hotel.scoreBreakdown.tripType}%`)
        )
      ) : null
    ),

    e("div", { className: "hcard-footer" },
      e("button", { className: "btn-details", onClick: onToggle }, isExpanded ? "Hide" : "Details"),
      e("a", { className: "btn-book", href: hotel.booking_link, target: "_blank", rel: "noreferrer" },
        `Book · ${providerName(hotel.booking_link)}`
      )
    )
  );
}

function scoreCell(label, val) {
  return e("div", { className: "score-cell" },
    e("div", { className: "score-cell-label" }, label),
    e("div", { className: "score-cell-val" }, val)
  );
}

/* ────────── SKELETON ────────── */
function LoadingSkeleton() {
  return e("div", null,
    e("div", { style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: "22px 26px", marginBottom: 24 } },
      e("div", { className: "skel", style: { height: 14, width: 160, marginBottom: 10, borderRadius: 4 } }),
      e("div", { className: "skel", style: { height: 11, width: 240, borderRadius: 4 } })
    ),
    e("div", { className: "skel-grid" },
      [0,1,2,3,4,5].map(i => e("div", { key: i, className: "skel-card" },
        e("div", { className: "skel", style: { height: 240 } }),
        e("div", { style: { padding: "22px 24px" } },
          e("div", { className: "skel", style: { height: 18, width: "70%", marginBottom: 10, borderRadius: 4 } }),
          e("div", { className: "skel", style: { height: 11, width: "45%", marginBottom: 18, borderRadius: 4 } }),
          e("div", { className: "skel", style: { height: 50, borderRadius: 6, marginBottom: 16 } }),
          e("div", { style: { display: "flex", gap: 10 } },
            e("div", { className: "skel", style: { height: 36, flex: 1, borderRadius: 100 } }),
            e("div", { className: "skel", style: { height: 36, flex: 2, borderRadius: 100 } })
          )
        )
      ))
    )
  );
}

root.render(e(App));
