export type TextBlock  = { type: "text"; html: string };
export type TitleBlock = { type: "title"; level: number; text: string };
export type ImageBlock = { type: "image"; ref: string; exportUrl?: string;
                           caption: string; variant: "small" | "large";
                           // Accessibility alt text, authored separately in the file's
                           // "Constructed Images" frame. DISTINCT from `caption`: the
                           // caption is the visible line of text rendered under the
                           // image (its own Text node in AEM, confirmed against a real
                           // approved page), while alt is the image node's own imageAlt
                           // property. Overwriting one with the other loses real content.
                           alt?: string;
                           // The image's own authored Figma layer name (e.g.
                           // "01_Dialog_Intro_v1.151"). Used verbatim as the DAM
                           // filename so the asset keeps the name the designer gave
                           // it, instead of an invented section-slug name that both
                           // loses that identity and collides when a section title
                           // repeats. Undefined only when the source node was
                           // genuinely unnamed.
                           figmaName?: string };
// A real AEM data-grid table (Library/Technical Name/Identifier and
// similar), NOT the generic Franklin "columns" 2-col layout block — a
// distinct AEM component (core/franklin/components/block, filter
// "ds-table-N-columns"). rows[0] is the header row; every cell is an HTML
// string (same rich-HTML-with-links convention as TextBlock.html). Row and
// column count are exactly whatever the source actually has — never a
// fixed/assumed shape, since a real guideline's table can have any count.
export type TableBlock = { type: "table"; rows: string[][] };
// AEM's real "Message Strip" block (model: design-system-portal_message-strip)
// — a dismissible banner with exactly two style variants seen in practice.
// Not the generic "Info" block below; a visually and structurally distinct
// AEM component with its own fixed field set (text/type/icon/isRtl).
export type MessageStripBlock = { type: "message-strip"; style: "information" | "warning"; html: string };
// AEM's real "Info" block (model: design-system-portal_info). "Top Tips" is
// NOT a separate component — it is this same block with infoClass "toptip"
// (confirmed directly against the real Universal Editor "Info Style"
// dropdown, which lists Top Tips alongside Information/Warning on one
// property). infoClass stays a free string, not a closed union: real pages
// already use "information"/"warning"/"toptip"/"guideline"/"hint"/"changes"
// and nothing says that list is exhaustive — closing it would silently
// reject a legitimate value this codebase just hasn't seen yet.
export type InfoBlock = { type: "info"; infoClass: string; html: string };
// AEM's real "Columns" layout block (core/franklin/components/columns) —
// 2 or 3 side-by-side columns, each holding its own arbitrary ordered mix
// of text/title/image (and rarely more than one block per column —
// confirmed live: one real 3-column example has a title+text pair
// followed by a SECOND title+text pair, all in the third column). Not
// recursive: no real example nests a Columns block inside another column.
export type ColumnsBlock = { type: "columns"; columnCount: number; columns: Block[][] };
// AEM's real "When to Use" block (model: design-system-portal_when-to-use)
// — the Do/Don't pattern. Two items, each tagged "do" or "dont" via a
// `class` property that drives AEM's own distinct styling (green/red).
// Confirmed directly against the real sample-page.infinity.json (NOT
// guessed, and NOT the same as the AEM UI's own dropdown display labels
// "Do"/"Don't" — the stored value is lowercase with no apostrophe at
// all: `class: "do"` / `class: "dont"`). Real structured data, not
// something inferrable from HTML content, so this is its own block type
// rather than two TextBlocks. showDivider is not inferrable from Figma
// (no visual signal seen there) — defaults to "false", matching the real
// template's own example (both its items use showDivider: "false").
export type WhenToUseItem = { doOrDont: "do" | "dont"; html: string; showDivider: boolean };
export type WhenToUseBlock = { type: "when-to-use"; items: WhenToUseItem[] };
export type Block = TextBlock | TitleBlock | ImageBlock | TableBlock
                   | MessageStripBlock | InfoBlock | ColumnsBlock | WhenToUseBlock;
export interface Section { title: string; blocks: Block[]; aemPath?: string;
                           // True only for the standalone Message Strip section. Confirmed
                           // against the real component guidance: "Don't use message strips
                           // within the page content" — it belongs in its own section, on top of
                           // every other section, with no heading of its own (the Universal
                           // Editor's own Message Strip panel has no Title field at all, only
                           // Text/Type/Icon/Right to Left). Putting the strip inside a section
                           // that ALSO holds a title/text/image was the real cause of a visible
                           // layout bug: Franklin auto-adds a `message-strip-container` class to
                           // any section containing that block, and the template's own CSS treats
                           // that class as full-bleed/hero-width — so the whole Intro section
                           // rendered ~150px wider than every other section. `title` is still a
                           // real, matchable string ("Message Strip") for this section — only the
                           // WRITE side skips creating a visible title node.
                           noTitle?: boolean;
                           // The heading level this section's own title carries, read from the
                           // Figma heading STYLE that identified it ("Heading/Medium/M" -> h2,
                           // "Heading/Medium/XXS" -> h3, "Heading/Regular/XXS" -> h4). Written
                           // to AEM as the title node's `titleType`. Undefined when the title
                           // was only recognised by layer NAME, which carries no level at all —
                           // the caller then falls back to the template's own default.
                           titleLevel?: "h2" | "h3" | "h4";
                           // Set only for AEM-sourced sections. parentAemPath is the shared
                           // top-level franklin section's aemPath when this Section is a nested
                           // (h3-delimited) logical section; undefined for a top-level section.
                           // childPaths is this logical section's own ordered child node paths
                           // (its title-delimited slice), used to scope write-back child lookups
                           // to just this section instead of every section sharing the same aemPath.
                           parentAemPath?: string; childPaths?: string[];
                           // Set only for AEM-sourced sections: the real JCR path of this
                           // section's OWN title node (not the section's aemPath — a nested
                           // subsection shares its parent's aemPath, but its title node is its
                           // own distinct child). Lets an update write a corrected titleType
                           // straight to the title node that already exists, instead of only
                           // ever being able to set it at creation time.
                           titlePath?: string; }
export interface GuidelineModel { component: string; source: "figma" | "aem"; sections: Section[];
                                  // The human-facing title identifying WHICH component/guideline this
                                  // model actually is (AEM: jcr:content["jcr:title"]; Figma: the file
                                  // name). Section titles alone (Intro, Types, Footer...) are reused
                                  // by every component's guideline and can't tell two different
                                  // components apart — this can. Undefined when unavailable.
                                  pageTitle?: string; }
