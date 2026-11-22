// v1.72.1 (D-395): the "switched off" screen's words for each feature switch
// a person can run into (tests/ui/nav-routes-v1721.test.ts).
export const SWITCHED_OFF_LABEL: Record<string, string> = {
  tasks: "Tasks",
  information: "Information",
  analytics: "Analytics",
  ai: "AI Assistant",
  pm_portfolios: "Portfolios",
  pm_extras: "Project templates",
};

export const switchedOffHref = (feature: string) => `/users/switched-off?${new URLSearchParams({ feature }).toString()}`;

export const switchedOffLabel = (feature: string | undefined) => (feature && Object.prototype.hasOwnProperty.call(SWITCHED_OFF_LABEL, feature) ? SWITCHED_OFF_LABEL[feature] : null);
