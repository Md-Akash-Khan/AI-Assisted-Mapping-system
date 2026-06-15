# Map Zone Intelligence V3

A practical backend-first system for fetching and normalizing zone-level POI/building evidence from Google, Barikoi, and OSM, then preparing safe Map Customizer apply payloads.

## Start

```bat
cd backend
npm start
```

Open:

```txt
http://localhost:3000/dashboard
```

No npm packages are required. It uses Node.js built-in modules and the built-in `fetch` available in recent Node versions.

## What this project does

1. Create a zone from center latitude/longitude + radius.
2. Fetch candidate places from Google Places Nearby Search, Barikoi Nearby/Reverse, and OSM Overpass.
3. Normalize names, categories, coordinates, address components, road hints, building/house hints.
4. Generate Bangla transliteration for names.
5. Format addresses in your Map Customizer style.
6. Detect conflicts between Google, Barikoi, and OSM.
7. Export review JSON, apply JSON, and CSV.
8. Provide a Chrome extension for capture/send/open-dashboard workflow.

## Address format rules

Building:

```txt
Akash Villa, house#45, Pragati Shoroni Road, Vatara, Dhaka-1230
```

Point inside building:

```txt
AK Software Ltd, house#45, Akash Villa, Pragati Shoroni Road, Vatara, Dhaka-1230
```

Missing fields are automatically skipped.
