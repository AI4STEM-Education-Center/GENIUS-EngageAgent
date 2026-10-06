import { describe, expect, it } from "vitest";
import { buildPublishedContentState } from "@/lib/published-content";

describe("buildPublishedContentState", () => {
  it("preserves a validated slide reference and discards unrecognized private fields", () => {
    const slides = { publicationId: "06c5a640-bbe6-400d-9430-4baf30b71e23", slideCount: 5, lessonNumber: 8 };
    const state = buildPublishedContentState([{ content_item_id: "slides-deck", content_json: JSON.stringify({
      id: "slides-deck", type: "Slides", title: "A spring", body: "", strategy: "cognitive conflict",
      slides, teacherNotes: "PRIVATE", checks: { key: "PRIVATE" },
    }) }], []);
    expect(state.contentItems[0].slides).toEqual(slides);
    expect(JSON.stringify(state)).not.toContain("PRIVATE");
  });

  it("does not activate the reader for malformed or non-slide references", () => {
    const state = buildPublishedContentState([
      { content_item_id: "a", content_json: JSON.stringify({ type: "Slides", slides: { publicationId: "https://other.example/private", slideCount: 5, lessonNumber: 8 } }) },
      { content_item_id: "b", content_json: JSON.stringify({ type: "Dialogue", slides: { publicationId: "06c5a640-bbe6-400d-9430-4baf30b71e23", slideCount: 5, lessonNumber: 8 } }) },
    ], []);
    expect(state.contentItems.every((item) => !item.slides)).toBe(true);
  });

  it("should merge embedded, published, and direct media using the published content id", () => {
    const state = buildPublishedContentState(
      [
        {
          content_item_id: "item-1",
          content_json: JSON.stringify({
            id: "temporary-id",
            type: "Dialogue",
            title: "Elastic Limit",
            body: "Body",
            strategy: "analogy",
            textModes: ["dialogue", "invalid"],
            visualBrief: "A lab scene",
            media: {
              image: "https://embedded.example.com/image.webp",
            },
          }),
          media: {
            video: "https://published.example.com/video.mp4",
          },
        },
      ],
      [
        {
          content_item_id: "item-1",
          media_type: "image",
          data_url: "https://media.example.com/image.webp",
        },
      ],
    );

    expect(state.contentItems).toEqual([
      {
        id: "item-1",
        type: "Dialogue",
        title: "Elastic Limit",
        body: "Body",
        strategy: "analogy",
        textModes: ["dialogue"],
        visualBrief: "A lab scene",
      },
    ]);
    expect(state.mediaByItemId).toEqual({
      "item-1": {
        image: "https://media.example.com/image.webp",
        video: "https://published.example.com/video.mp4",
      },
    });
  });

  it("should fall back safely when content json is invalid or media is blank", () => {
    const state = buildPublishedContentState(
      [
        {
          content_item_id: "item-2",
          content_json: "{not-json}",
          media: {
            image: "   ",
          },
        },
      ],
      [
        {
          content_item_id: "item-2",
          media_type: "video",
          data_url: "",
        },
      ],
    );

    expect(state.contentItems).toEqual([
      {
        id: "item-2",
        type: "unknown",
        title: "Content",
        body: "",
        strategy: "",
      },
    ]);
    expect(state.mediaByItemId).toEqual({});
  });
});
