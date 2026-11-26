import { MessageSquare } from "lucide-react";
import { Badge } from "@/features/ui/Display";

// v1.91.0 (D-434, owner: "in this case I am a commenter. If I have the module
// access then I have my same privileges."): shown on an item opened by a
// collaborator who doesn't have its module, so they know why only reading and
// commenting are offered. The server refuses everything else anyway.
export function CommenterBadge({ module }: { module: string }) {
  return (
    <span title={`You were added as a collaborator. Without the ${module} module you can read this and comment (no files, no other changes).`} data-testid="commenter-badge">
      <Badge tone="info" icon={<MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />}>
        Commenter
      </Badge>
      <span className="sr-only">: you can read this and comment; adding files and other changes need the {module} module.</span>
    </span>
  );
}
