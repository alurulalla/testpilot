/**
 * Replace impossible combobox names made by concatenating all option labels.
 * Prefer a stable sort/select/filter data-test already used in the file.
 */
export function sanitizeComboboxLocators(content: string): string {
  const stable = content.match(
    /page\.locator\(\s*(['"])(\[(?:data-test|data-testid)=["'][^"']*(?:sort|select|filter)[^"']*["']\])\1\s*\)/i,
  );
  const replacement = stable
    ? `page.locator(${JSON.stringify(stable[2])})`
    : `page.locator('select').first()`;

  return content.replace(
    /page\.getByRole\(\s*(['"])combobox\1\s*,\s*\{\s*name:\s*(['"])([^'"]+)\2\s*\}\s*\)/g,
    (full, _roleQuote: string, _nameQuote: string, name: string) => {
      const optionLike = name.length >= 60 ||
        (name.match(/\([^)]*\)/g)?.length ?? 0) >= 3 ||
        /low to high.*high to low/i.test(name);
      return optionLike ? replacement : full;
    },
  );
}
