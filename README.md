# AI Hotel Discovery Agent

A hackathon-ready MVP that helps users discover hotels with natural language instead of rigid filters.

## What it does

- Accepts conversational search queries like `Goa trip with friends, budget 5000 per night, near beach, good nightlife`
- Supports structured preferences for trip type, amenities, experience type, and location preference
- Extracts structured intent:
  - location
  - budget
  - trip type
  - preferences
- Applies strict city filtering before ranking
- Falls back transparently to nearby or wider alternatives when exact matches do not exist
- Ranks a mock hotel dataset with weighted scoring:
  - location 50%
  - budget 20%
  - preferences 20%
  - trip type 10%
- Returns the top 5 hotel matches with reasons and "why not others" context
- Applies hard filters for selected trip type and amenities before scoring
- Shows extracted intent tags, confidence score, labels, and a refine-results flow
- Uses OpenAI for intent extraction and explanations when `OPENAI_API_KEY` is set
- Falls back to deterministic logic when no API key is provided

## Folder structure

```text
.
├── public
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── server
│   ├── data
│   │   └── hotels.js
│   ├── services
│   │   ├── hotelAgent.js
│   │   └── openai.js
│   └── server.js
├── .env.example
├── package.json
└── README.md
```

## Run locally

1. Make sure you have Node.js 18+ installed.
2. Add your values to `.env` if you want OpenAI-enabled explanations:

```bash
OPENAI_API_KEY="your_key_here"
OPENAI_MODEL="gpt-4o-mini"
PORT=3000
```

3. Start the app:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

## Notes

- No authentication is required.
- No booking API is used.
- The dataset is intentionally mocked for speed and demo clarity.
- The frontend is built with React and served as a lightweight static app.
- `.env` is loaded automatically at server startup.
- If the OpenAI key is missing or the API call fails, the app still works using local extraction and explanation logic.

## Demo prompts

- `Family trip in Delhi under ₹5000`
- `Goa trip with friends, budget 5000 per night, near beach, good nightlife`
- `quiet solo stay in Manali under 6000 with mountain views`
- `family vacation in Udaipur around 9000, heritage feel, lake view`
# AI-HOTELS
