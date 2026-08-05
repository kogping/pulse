import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { decodeLiveFeed } from "./gtfsr-decode";

// Encodes and decodes each fixture in fixtures/gtfs/realtime/ through the
// real GTFS-R protobuf wire format (see that directory's README.md for why
// these are synthetic rather than genuine TfNSW captures) and asserts the
// countdown decodeLiveFeed produces is within ±2 minutes of the fixture's
// documented ground truth — the accuracy bar the roadmap sets for F3.
const FIXTURES_DIR = path.join(__dirname, "..", "..", "..", "..", "fixtures", "gtfs", "realtime");

interface FixtureEntity {
  id: string;
  routeId: string;
  stopId: string;
  departureEpochSeconds: number;
}

interface Fixture {
  description: string;
  capturedAtEpochSeconds: number;
  hubStopId: string;
  groundTruthMinutesUntilDeparture: number;
  entities: FixtureEntity[];
}

function loadFixture(fileName: string): Fixture {
  const raw = readFileSync(path.join(FIXTURES_DIR, fileName), "utf8");
  return JSON.parse(raw) as Fixture;
}

function encodeFeed(fixture: Fixture): Uint8Array {
  const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0", timestamp: fixture.capturedAtEpochSeconds },
    entity: fixture.entities.map((e) => ({
      id: e.id,
      tripUpdate: {
        trip: { routeId: e.routeId },
        stopTimeUpdate: [{ stopId: e.stopId, departure: { time: e.departureEpochSeconds } }],
      },
    })),
  });
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
}

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

describe("countdown accuracy against recorded GTFS-R fixtures", () => {
  it("found fixtures to test against", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of fixtureFiles) {
    it(`${fileName}: decoded countdown is within ±2 minutes of ground truth`, () => {
      const fixture = loadFixture(fileName);
      const buffer = encodeFeed(fixture);
      const capturedAt = new Date(fixture.capturedAtEpochSeconds * 1000);

      const decoded = decodeLiveFeed(buffer, new Set([fixture.hubStopId]), capturedAt);

      expect(decoded.nextDeparture).not.toBeNull();
      const minutesUntilDeparture =
        (new Date(decoded.nextDeparture!.departsAt).getTime() - capturedAt.getTime()) / 60_000;

      expect(Math.abs(minutesUntilDeparture - fixture.groundTruthMinutesUntilDeparture)).toBeLessThanOrEqual(2);
    });
  }
});
