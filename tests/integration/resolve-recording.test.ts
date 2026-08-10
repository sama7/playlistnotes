import { PrismaClient, Provider, RecordingOrigin } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUserAuthoredRecording, resolveByProviderId } from "@/lib/music/resolve-recording";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

const CN_TOWER = {
  provider: Provider.spotify,
  providerId: "4u43I0LP2Xf85OAS85eG0R",
  title: "CN TOWER",
  artistDisplay: "PARTYNEXTDOOR & Drake",
  durationMs: 241_890,
  isrc: "USLD91772040",
};

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveByProviderId", () => {
  it("creates on first sight and records provenance", async () => {
    const result = await resolveByProviderId(CN_TOWER);

    expect(result.decision).toBe("created");
    expect(result.strategy).toBe("created");
    expect(result.recording.origin).toBe(RecordingOrigin.provider);
    expect(result.recording.artistDisplay).toBe("PARTYNEXTDOOR & Drake");
  });

  /**
   * The property the whole capture flow rests on: everyone's Spotify URI for a
   * track is byte-identical, so exact matching deduplicates without any fuzzy
   * comparison — and without ever risking a false merge.
   */
  it("returns the same recording when the same track is captured again", async () => {
    const first = await resolveByProviderId(CN_TOWER);
    const second = await resolveByProviderId(CN_TOWER);

    expect(second.decision).toBe("matched");
    expect(second.strategy).toBe("provider-id");
    expect(second.recording.id).toBe(first.recording.id);
    expect(await prisma.recording.count()).toBe(1);
  });

  it("matches even when the second capture carries no metadata at all", async () => {
    const first = await resolveByProviderId(CN_TOWER);

    // oEmbed was down for this user; only the id survived.
    const second = await resolveByProviderId({
      provider: Provider.spotify,
      providerId: CN_TOWER.providerId,
    });

    expect(second.recording.id).toBe(first.recording.id);
    expect(second.recording.title).toBe("CN TOWER");
  });

  it("keeps different tracks apart", async () => {
    await resolveByProviderId(CN_TOWER);
    await resolveByProviderId({
      provider: Provider.spotify,
      providerId: "7KGHenqXZofXNm5MKDbT3J",
      title: "Whisper My Name",
      artistDisplay: "Drake",
    });

    expect(await prisma.recording.count()).toBe(2);
  });

  /** Two people capturing the same track at the same instant. */
  it("creates exactly one recording under concurrent first capture", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => resolveByProviderId(CN_TOWER)),
    );

    expect(new Set(results.map((r) => r.recording.id)).size).toBe(1);
    expect(await prisma.recording.count()).toBe(1);
    expect(await prisma.recordingExternalId.count()).toBe(1);
  });

  /** AGENTS.md §7: resolution must never hand back a tombstone. */
  it("follows a merge rather than returning the merged-away recording", async () => {
    const loser = await resolveByProviderId(CN_TOWER);
    const winner = await prisma.recording.create({
      data: {
        title: "CN TOWER",
        artistDisplay: "PARTYNEXTDOOR & Drake",
        origin: RecordingOrigin.provider,
        normalizedKey: "v1:partynextdoor drake:cn tower:48",
      },
    });
    await prisma.recording.update({
      where: { id: loser.recording.id },
      data: { mergedIntoId: winner.id },
    });

    const resolved = await resolveByProviderId(CN_TOWER);

    expect(resolved.recording.id).toBe(winner.id);
    expect(resolved.recording.mergedIntoId).toBeNull();
  });

  it("survives a merge chain without looping forever", async () => {
    const first = await resolveByProviderId(CN_TOWER);
    const middle = await prisma.recording.create({
      data: { title: "m", artistDisplay: "m", origin: RecordingOrigin.provider, normalizedKey: "m" },
    });
    const final = await prisma.recording.create({
      data: { title: "f", artistDisplay: "f", origin: RecordingOrigin.provider, normalizedKey: "f" },
    });

    await prisma.recording.update({
      where: { id: first.recording.id },
      data: { mergedIntoId: middle.id },
    });
    await prisma.recording.update({ where: { id: middle.id }, data: { mergedIntoId: final.id } });

    expect((await resolveByProviderId(CN_TOWER)).recording.id).toBe(final.id);
  });

  it("falls back to placeholders rather than refusing to create", async () => {
    const result = await resolveByProviderId({
      provider: Provider.spotify,
      providerId: "0VaeksJaXy5R1nvcTMh3Xk",
    });

    expect(result.recording.title).toBe("Untitled");
    expect(result.recording.artistDisplay).toBe("Unknown artist");
  });
});

describe("createUserAuthoredRecording", () => {
  it("marks the recording as user-authored and scopes it to its creator", async () => {
    const user = await prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });

    const result = await createUserAuthoredRecording({
      ownerId: user.id,
      title: "Marvins Room — live, Ottawa (phone recording)",
      artistDisplay: "Drake",
    });

    expect(result.recording.origin).toBe(RecordingOrigin.user);
    expect(result.recording.createdById).toBe(user.id);
    expect(await prisma.recordingExternalId.count()).toBe(0);
  });

  /**
   * Two people typing the same obscure song get two rows, deliberately. Merging
   * them on string similarity is the false merge the catalog policy forbids;
   * promotion happens later via identifiers or convergence, never by guessing.
   */
  it("never merges two users' typed entries, even when identical", async () => {
    const a = await prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
    const b = await prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });

    const first = await createUserAuthoredRecording({
      ownerId: a.id,
      title: "Basement Take",
      artistDisplay: "The Fenwick Sisters",
    });
    const second = await createUserAuthoredRecording({
      ownerId: b.id,
      title: "Basement Take",
      artistDisplay: "The Fenwick Sisters",
    });

    expect(second.recording.id).not.toBe(first.recording.id);
    expect(await prisma.recording.count()).toBe(2);
    // Same normalized key, though — which is what makes future convergence
    // promotion a query rather than a migration.
    expect(second.recording.normalizedKey).toBe(first.recording.normalizedKey);
  });
});
