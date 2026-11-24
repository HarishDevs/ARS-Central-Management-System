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

// v1.89.0 (D-425, UIQA-CON-08 / ERR-01): dates and times are written by lib/format/date.ts only.
//   ars-ui/date-format   toLocaleDateString / toLocaleTimeString, Intl.DateTimeFormat /
//                        RelativeTimeFormat, and toLocaleString on a Date (new Date(...)) or
//                        with date options (day, month, hour, dateStyle, timeZone …). A plain
//                        number's toLocaleString("en-IN") stays allowed (figures, not dates).
const DATE_KEYS = new Set(["day", "month", "year", "weekday", "hour", "minute", "second", "dateStyle", "timeStyle", "timeZone", "hour12", "hourCycle", "era", "timeZoneName"]);
const dateFormat = {
  meta: { type: "problem", messages: { local: "Write dates with lib/format/date.ts (formatDate, formatDateTime, formatTime, formatRelative, <RelativeTime> …), not {{what}}: one India-time format everywhere and no server / browser difference (D-425)." }, schema: [] },
  create: (context) => {
    const report = (node, what) => context.report({ node, messageId: "local", data: { what } });
    const isIntl = (node, name) => node?.type === "MemberExpression" && node.object?.type === "Identifier" && node.object.name === "Intl" && node.property?.name === name;
    return {
      NewExpression(node) {
        if (isIntl(node.callee, "DateTimeFormat") || isIntl(node.callee, "RelativeTimeFormat")) report(node, `Intl.${node.callee.property.name}`);
      },
      CallExpression(node) {
        if (isIntl(node.callee, "DateTimeFormat")) return report(node, "Intl.DateTimeFormat");
        if (node.callee.type !== "MemberExpression" || node.callee.property?.type !== "Identifier") return;
        const name = node.callee.property.name;
        if (name === "toLocaleDateString" || name === "toLocaleTimeString") return report(node, name);
        if (name !== "toLocaleString") return;
        const target = node.callee.object;
        const onDate = target?.type === "NewExpression" && target.callee?.type === "Identifier" && target.callee.name === "Date";
        const options = node.arguments[1];
        const dateOptions = options?.type === "ObjectExpression" && options.properties.some((p) => p.type === "Property" && DATE_KEYS.has(p.key?.name ?? p.key?.value));
        if (onDate || dateOptions) report(node, "toLocaleString on a date");
      },
    };
  },
};

// v1.89.0 stage 4 (D-426, owner: one design system everywhere): no native date inputs.
//   ars-ui/date-input    <input type="date" | "datetime-local" | "month" | "week">: use
//                        DateField (one day, or a day and a time) or DateRangeField /
//                        DateRangePicker (From - To) from features/ui. Time-only boxes stay.
const NATIVE_DATE_TYPES = new Set(["date", "datetime-local", "month", "week"]);
const dateInput = {
  meta: { type: "problem", messages: { native: "<input type=\"{{type}}\"> shows the browser's own date format and calendar: use DateField (features/ui/DateField.tsx) or DateRangeField / DateRangePicker (D-426)." }, schema: [] },
  create: (context) => ({
    JSXOpeningElement(node) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "input") return;
      const type = node.attributes.find((a) => a.type === "JSXAttribute" && a.name?.name === "type");
      // A literal, or any literal inside the expression (type={kind === "DATE" ? "date" : "text"}).
      const literals = [];
      const collect = (expr) => {
        if (!expr) return;
        if (expr.type === "Literal") literals.push(expr.value);
        else if (expr.type === "ConditionalExpression") [expr.consequent, expr.alternate].forEach(collect);
        else if (expr.type === "LogicalExpression") [expr.left, expr.right].forEach(collect);
        else if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) literals.push(expr.quasis[0]?.value?.cooked);
      };
      if (type?.value?.type === "Literal") literals.push(type.value.value);
      else if (type?.value?.type === "JSXExpressionContainer") collect(type.value.expression);
      const value = literals.find((item) => typeof item === "string" && NATIVE_DATE_TYPES.has(item));
      if (value) context.report({ node, messageId: "native", data: { type: value } });
    },
  }),
};

export const arsUi = { rules: { "control-size": controlSize, "spacing-scale": spacingScale, "type-scale": typeScale, "date-format": dateFormat, "date-input": dateInput } };
