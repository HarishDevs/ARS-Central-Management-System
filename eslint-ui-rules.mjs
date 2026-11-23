// v1.89.0 (D-422, UI unification batch 2): lint rules that keep the adopted
// design tokens (docs/qa/GLOBAL_DESIGN_SYSTEM.md §A) from drifting again.
// They read class strings (string literals and template parts) only.
//
//   ars-ui/control-size   a fixed height (h-9, h-[38px], ...) next to a named control
//                         class: the control sizes are tokens (UIQA-CON-05 / CON-06).
//                         Use field-compact / btn-compact / btn-lg instead; h-auto
//                         and min-h-* stay allowed (textareas, multi-selects).
//   ars-ui/spacing-scale  an arbitrary px / rem padding, margin or gap (p-[13px],
//                         gap-[0.3rem]): use the 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
//                         scale (C15). calc(), env() and viewport units stay allowed.
//   ars-ui/type-scale     the retired sizes text-title / text-card-title / text-greeting:
//                         use text-page-title, text-section or text-stat.

const CONTROLS = new Set(["field-input", "field-compact", "btn-primary", "btn-secondary", "btn-danger", "btn-danger-quiet", "btn-ghost", "btn-compact", "btn-lg", "tb-btn", "tb-split", "pill-select"]);
const FIXED_HEIGHT = /^(?:[\w-]+:)*!?h-(?:\d|\[|px$)/;
const ARBITRARY_SPACING = /^(?:[\w-]+:)*!?-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[-?[\d.]+(?:px|rem)\]$/;
const RETIRED_TYPE = /^(?:[\w-]+:)*!?text-(?:title|card-title|greeting)$/;

function classStrings(context, check) {
  const visit = (node, text) => {
    if (typeof text !== "string" || !text.includes("-")) return;
    check(node, text.split(/\s+/).filter(Boolean));
  };
  return {
    Literal(node) {
      // A JSX attribute other than className (a data-testid, a label) is not a class list.
      if (node.parent?.type === "JSXAttribute" && !["className", "class"].includes(node.parent.name?.name)) return;
      visit(node, node.value);
    },
    TemplateElement(node) {
      visit(node, node.value.cooked ?? node.value.raw);
    },
  };
}

const controlSize = {
  meta: { type: "problem", messages: { fixed: "'{{height}}' next to '{{control}}': control heights come from the size tokens (field-compact 32, field-input 42, btn-compact 32, btn-* 40, btn-lg 48). Remove the height or pick a size class." }, schema: [] },
  create: (context) =>
    classStrings(context, (node, tokens) => {
      const control = tokens.find((t) => CONTROLS.has(t));
      if (!control) return;
      const height = tokens.find((t) => FIXED_HEIGHT.test(t));
      if (height) context.report({ node, messageId: "fixed", data: { height, control } });
    }),
};

const spacingScale = {
  meta: { type: "problem", messages: { arbitrary: "'{{value}}' is off the spacing scale (4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48): use the Tailwind steps 1 2 3 4 5 6 8 10 12." }, schema: [] },
  create: (context) =>
    classStrings(context, (node, tokens) => {
      const value = tokens.find((t) => ARBITRARY_SPACING.test(t));
      if (value) context.report({ node, messageId: "arbitrary", data: { value } });
    }),
};

const typeScale = {
  meta: { type: "problem", messages: { retired: "'{{value}}' is retired (D-422): use text-page-title (page h1), text-section (section heading) or text-stat (a figure)." }, schema: [] },
  create: (context) =>
    classStrings(context, (node, tokens) => {
      const value = tokens.find((t) => RETIRED_TYPE.test(t));
      if (value) context.report({ node, messageId: "retired", data: { value } });
    }),
};

export const arsUi = { rules: { "control-size": controlSize, "spacing-scale": spacingScale, "type-scale": typeScale } };
