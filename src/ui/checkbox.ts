let nextId = 0;

// Pajamas checkbox (gl-form-checkbox)
export function checkbox(
  label: string,
  {
    id = `mrflow-checkbox-${++nextId}`,
    checked = false,
    className = "",
    onChange,
  }: { id?: string; checked?: boolean; className?: string; onChange?: (checked: boolean) => void } = {},
): { root: HTMLDivElement; input: HTMLInputElement } {
  const root = document.createElement("div");
  root.className = `gl-form-checkbox custom-control custom-checkbox ${className}`.trim();

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "custom-control-input";
  input.id = id;
  input.checked = checked;
  input.addEventListener("change", () => onChange?.(input.checked));

  const labelEl = document.createElement("label");
  labelEl.className = "custom-control-label";
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  root.append(input, labelEl);
  return { root, input };
}
