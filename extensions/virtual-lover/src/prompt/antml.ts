export interface RenderablePromptSection {
  id: string;
  title: string;
  content: string;
}

export function renderAntmlDocument(sections: RenderablePromptSection[]): string {
  if (sections.length === 0) return '';

  const renderedSections = sections
    .map((section) => renderAntmlSection(section))
    .join('\n\n');

  return `<virtual-lover-context>\n${renderedSections}\n</virtual-lover-context>`;
}

export function renderMarkdownDocument(sections: RenderablePromptSection[]): string {
  return sections
    .map((section) => `## ${section.title}\n\n${section.content.trim()}`)
    .join('\n\n---\n\n');
}

function renderAntmlSection(section: RenderablePromptSection): string {
  const id = escapeAttribute(section.id);
  const title = escapeAttribute(section.title);
  return `<section id="${id}" title="${title}">\n${section.content.trim()}\n</section>`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
