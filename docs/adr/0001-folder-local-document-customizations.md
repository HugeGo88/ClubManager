# Keep document customizations with each data folder

**Status: Accepted**

ClubManager will support multiple registered data folders, with each folder owning its meeting and letter PDF templates, shared PDF stylesheet, and signature library. Missing custom files use the corresponding packaged defaults; module visibility and sidebar preference remain app-wide. This keeps club-specific branding and signatures from leaking across folders while allowing each folder to be moved or backed up with its documents. Existing global customizations and signatures will be copied into the active folder, or the first folder added when none is active; existing destination customization files are preserved and conflicts reported rather than overwritten.

The alternative—keeping templates and signatures global—would make folder switching simpler, but could apply one club's branding or signatures to another club's documents.
