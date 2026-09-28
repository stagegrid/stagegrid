# Write a {{template}} with Stagegrid

1. `list_doc_templates` for the project. If "{{template}}" isn't an exact key, pick the closest and confirm with the user. Note its `level`: project, item (needs `item`), or release (needs `release`).
2. `get_doc_template` — every section and field has a hint saying what to write. Sections that repeat per item or per release item are already listed.
3. Gather context: `get_board` (compact) for the item tree and statuses; `get_cell` for items that matter (comments and links hold decisions); `get_release` for release documents; the user's own notes.
4. Ask the user only what the data can't tell you — at most three questions at a time.
5. Write every section following its hint, in the language the user writes in. Content is markdown without headings. Leave a section empty rather than inventing facts.
6. `save_doc_draft`. If the document belongs to a cell (for example the "Document" stage of an item), pass `item` and `stage` so the board links to it.
7. Give the user the `viewUrl` and a Word link from `get_doc_download_url`. Offer to publish to Confluence (`render_doc` format confluence → Atlassian MCP, body unchanged) and to update the cell's status — ask first.
