# Railway Management System

A single-page railway management demo built with plain HTML, CSS and JavaScript. It simulates one line from Kavali to Chennai (Kavali, Nellore, Gudur, Tirupati, Chennai) with trains running live, and lets you search for trains, check seat availability and book tickets with passenger details.

No frameworks, no build step, no dependencies.

## Features

- **Live line map:** trains move between stations in real time, wait at stations and are held at a red signal when another train is too close ahead.
- **Live board:** departure board for any station with due time, platform and status, plus a control log of events.
- **Find a train:** search by train number or name, or by From and To stations, and sort by earliest departure, shortest trip or most seats free.
- **Seat availability:** free and booked seats per class for any journey, with a seat map. A seat booked for part of the route stays free for the rest.
- **Book a ticket:** choose the train, stations and class, then enter name, age and gender for each passenger plus a phone number and optional email. Seats are assigned automatically and the fare is calculated.
- **Passengers:** every passenger with seat, journey, ticket number and contact, filterable by train, status and search text.
- **Timetable:** each train's position, next stop and status, and a form to add new trains.
- **Controls:** pause and 1x, 2x, 4x speed. Light and dark themes follow the system setting.

## Run it

Open `index.html` in a browser. No server is needed.

Or serve the folder locally:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Publish with GitHub Pages

1. Push this folder to a GitHub repository.
2. Open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. Save. The site appears at `https://<your-username>.github.io/<repository-name>/` after a minute or two.

## Project structure

```
railway-management-system/
├── index.html      page structure and tabs
├── css/
│   └── style.css   layout, colours, light and dark themes
├── js/
│   └── app.js      simulation, search, seats, booking and passenger logic
└── README.md
```

## Customise

Everything below is near the top of `js/app.js`.

- **Stations and distances:** edit `ST` (names) and `KM` (approximate distance in km from the first station).
- **Starting trains:** edit the `trains.push(...)` block. `from` and `to` are positions in `ST`, starting at 0.
- **Classes and fares:** edit `CLASSES`. The fare is the distance in km times 1.15 times the class multiplier.
- **Signal gap:** `MINGAP` is the minimum distance in km between two trains on the same track.
- **Clock speed:** `SIM` is the number of simulated minutes per tick. One tick is one second at 1x.

## How it works

- Each tick moves every train along the line. A train is held when another train on the same track is closer than `MINGAP` km ahead.
- Seats are counted per train run and per journey. When a train reaches the end of the line it turns round and starts a new run with all seats free.
- A ticket is marked Completed when its train reaches the passenger's destination.
- Tickets are saved in the browser's `localStorage`. The simulation restarts on every page load, so tickets from an earlier visit show as Completed.

## Notes

This is a demo. Data stays in your browser, distances are approximate and no real railway data is used.
