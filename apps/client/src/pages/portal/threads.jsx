import React from "react";
import ThreadListView from "../../components/communication/ThreadListView";

export default function PortalThreads() {
  return (
    <ThreadListView
      title="Conversations"
      description="Browse communication threads linked to your applications."
      basePath="/portal"
      emptyLabel="No conversations found."
    />
  );
}
