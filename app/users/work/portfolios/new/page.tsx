import type { Metadata } from "next";
import { PortfolioWizard } from "@/features/work/portfolios/PortfolioWizard";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { portfolioPage, peopleOptions } from "@/server/work/page-context";
import { workChoices } from "@/server/work/portfolios";

export const metadata: Metadata = { title: "New portfolio" };
export const dynamic = "force-dynamic";

// v1.69.0 (D-382): create a portfolio step by step.
export default async function NewPortfolioPage() {
  const { user, viewer } = await portfolioPage();
  const [choices, departments, people] = await Promise.all([workChoices(user), listDepartments(), peopleOptions()]);
  return (
    <PortfolioWizard
      projects={choices.projects}
      portfolios={choices.portfolios}
      departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }))}
      myDepartmentId={viewer.departmentId}
      people={people}
      meId={user.id}
    />
  );
}
