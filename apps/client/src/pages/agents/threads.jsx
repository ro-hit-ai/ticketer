import React from "react";
import ThreadListView from "../../components/communication/ThreadListView";

export default function AgentThreads() {
  return (
    <ThreadListView
      title="Threads"
      description="Review communication threads and open the full conversation detail."
      basePath="/agents"
      emptyLabel="No threads found."
    />
  );
}
