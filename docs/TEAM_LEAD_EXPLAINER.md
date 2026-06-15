# Team Lead Explainer: Map Zone Intelligence V3

## Problem

Map Customizer already has buildings, roads, and feature forms, but it does not automatically know the correct place name, Bangla name, road, house number, postcode, or category details. Manual lookup from Google Maps, Barikoi, and OSM takes time and causes mistakes.

## Proposed solution

A backend-first zone intelligence system:

1. Mapper opens a zone such as Uttara Sector 12, Banani DOHS, or a selected block.
2. Extension captures current map center/bounds or the mapper enters center + radius.
3. Backend fetches POI and address evidence from Google Places, Barikoi, and OSM.
4. Backend normalizes all candidates into a Map Customizer-ready format.
5. Backend builds Bangla transliteration for names.
6. Backend detects conflicts between sources.
7. Mapper reviews candidates and applies selected records one by one.

## Why zone-level fetch?

Instead of searching one feature manually, we cache intelligence for a full zone. Later, while adding a point/building, the system can use the stored zone database to autofill name, Bangla name, category, address, and tags.

## Data sources

### Google

Used for business/POI discovery:
- Places Nearby Search for places within a radius.
- Places Text Search internally for hard categories such as office/software company.
- Geocoding later for address validation.

### Barikoi

Used for Bangladesh-local address context:
- Reverse Geocode: center/point to readable address.
- Nearby category: local POI candidates.
- Rupantor can be added later for better address parsing.

### OSM / Overpass

Used for roads, amenities, buildings, and public OSM features.

## Address formatting rule

Building:

`Akash Villa, house#45, Pragati Shoroni Road, Vatara, Dhaka-1230`

Point inside building:

`AK Software Ltd, house#45, Akash Villa, Pragati Shoroni Road, Vatara, Dhaka-1230`

Missing fields are skipped automatically.

## Conflict rules

1. Google and Barikoi same name but coordinate different: merge group, flag coordinate_mismatch, human review.
2. Google road and Barikoi road different: road_conflict, do not auto-fill road.
3. Coordinate outside zone but address matches zone: review, not reject.
4. Coordinate inside zone but address says different block: field check.
5. Same point but different names: possible stale/duplicate data, manual check.
6. House number mismatch: never auto-fill automatically.
7. One-source-only candidate: review unless very strong evidence.
8. Low-confidence/outside-buffer candidate: keep in database but do not apply.

## Safety rule

The system must never bulk save. It prepares Apply JSON; the extension fills one record at a time; the mapper verifies and saves manually.
