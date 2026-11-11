import { parseFeed } from "@/lib/connectors/web/feed";

describe("parseFeed", () => {
  it("reads RSS 2.0 with its guids, dates, creators and categories", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>Release notes</title>
          <item>
            <title>v2.0 is out</title>
            <link>https://example.com/v2</link>
            <guid isPermaLink="false">rel-200</guid>
            <pubDate>Tue, 10 Nov 2026 18:00:00 GMT</pubDate>
            <description>&lt;p&gt;Big &amp;amp; better&lt;/p&gt;</description>
            <dc:creator>Ana</dc:creator>
            <category>release</category>
          </item>
        </channel>
      </rss>`);
    expect(feed.title).toBe("Release notes");
    expect(feed.entries[0]).toEqual({
      id: "rel-200",
      title: "v2.0 is out",
      link: "https://example.com/v2",
      published: new Date("2026-11-10T18:00:00.000Z"),
      summary: "<p>Big &amp; better</p>",
      authors: ["Ana"],
      categories: ["release"],
    });
  });

  it("reads Atom, taking the alternate link", () => {
    const feed =
      parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
      <entry><id>tag:x,2026:1</id><title type="html">Hello</title>
        <link rel="related" href="https://x.io/pdf"/><link rel="alternate" href="https://x.io/1"/>
        <published>2026-11-09T10:00:00Z</published><summary>Hi</summary>
        <author><name>Bo</name></author><category term="cs.LG"/></entry></feed>`);
    expect(feed.entries[0]).toMatchObject({
      id: "tag:x,2026:1",
      title: "Hello",
      link: "https://x.io/1",
      authors: ["Bo"],
      categories: ["cs.LG"],
    });
  });

  it("refuses a document that declares its own entities, and anything that isn't a feed", () => {
    expect(() =>
      parseFeed(
        `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>`
      )
    ).toThrow(/entities/);
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow(
      /isn't an RSS or Atom feed/
    );
  });
});
