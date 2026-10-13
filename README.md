# Life's Moments — Thasos

Website prototype for the Life's Moments holiday rental on Thasos.

- `index.html` — the whole site (hero with drone video / 3D house, date booking, gallery, Thasos guide stub)
- `redesign.html` — the new version: real photos of the property, editorial titles, a "day at the house" scene that goes from morning to night as you scroll, an auto-sliding strip with photos of each of the 11 rooms and the apartment, a Thasos guide, and Google reviews at the bottom. One fixed colour style; the preview panel on the right lists 14 colour options with their hex codes. Photos per room go in `UNIT_PHOTOS` in the script.
- `admin.html` — preview of the owner's admin panel (desktop) with fake data: a board of the 12 units for today, booking requests with a 24-hour timer and room picking, a 14-day calendar, bookings, customers with their stay history and notes, monthly stats (occupancy per day and per room, revenue by source), a price calendar where you pick dates and set specific prices, and settings. The switch at the bottom left flips between the two versions: owner approves each request, or everything runs automatically through Beds24 (`?mode=auto`).
- `photos/` — photos of the property, resized for the web
- `hero-1600.mp4`, `hero-960.mp4` — hero video for desktop and mobile
- `hero-poster.jpg` — still frame shown while the video loads

The drone video is a placeholder until real footage of the property is ready.

## Run it

Open `index.html` in a browser, or turn on GitHub Pages (Settings → Pages → branch `main`, folder `/`).
