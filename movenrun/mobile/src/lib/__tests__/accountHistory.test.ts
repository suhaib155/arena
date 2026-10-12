import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAccountHistory } from "../accountHistory";

test("only verified sessions count toward what the account holds", () => {
  const summary = summarizeAccountHistory([
    { status: "verified", distanceMeters: 1200 },
    { status: "verified", distanceMeters: 850 },
    { status: "rejected", distanceMeters: 5000 },
    { status: "pending", distanceMeters: 3000 },
    { status: "verified", distanceMeters: null },
  ]);
  assert.equal(summary.verifiedCount, 3);
  assert.equal(summary.totalDistanceMeters, 2050);
  assert.equal(summary.label, "3 verified sessions saved to this account · 2.1 km");
});

test("an empty or unverified history says so plainly", () => {
  assert.equal(summarizeAccountHistory([]).label, "No verified sessions saved to this account yet.");
  assert.equal(summarizeAccountHistory([{ status: "rejected", distanceMeters: 900 }]).verifiedCount, 0);
  assert.equal(summarizeAccountHistory([{ status: "verified", distanceMeters: 12_400 }]).label,
    "1 verified session saved to this account · 12 km");
});
