// Routes that send files set their own, stricter Content-Security-Policy (a
// sandbox for attachments and the PDF summary, RD-02); the middleware's page
// policy must not replace it.
// D-389 (QA security L-2): the later file routes too: task, ticket, info and
// project files (/api/files/:id), a form's cover picture and a person's photo.
export const FILE_ROUTE = /^\/api\/(attachments\/\d+|files\/\d+|forms\/[^/]+\/cover|users\/\d+\/photo|requests\/\d+\/summary\.pdf)$/;
