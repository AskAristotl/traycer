import "../../../../../__tests__/test-browser-apis";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  SplitContainer,
  type SplitPaneComponentProps,
} from "../split-container";
import type { TileLayoutNode, TilePane } from "@/stores/epics/canvas/tile-tree";

function pane(id: string): TilePane {
  return {
    kind: "pane",
    id,
    tabInstanceIds: [],
    activeTabId: null,
    previewTabId: null,
  };
}

function StubPane(props: SplitPaneComponentProps) {
  return <div data-testid="pane" data-pane-id={props.pane.id} />;
}

const twoPaneSplit: TileLayoutNode = {
  kind: "group",
  id: "g1",
  direction: "horizontal",
  children: [pane("p1"), pane("p2")],
};

afterEach(() => cleanup());

describe("SplitContainer mobile collapse", () => {
  it("renders the split tree (with split groups) on desktop", () => {
    const { container, queryByTestId } = render(
      <SplitContainer
        root={twoPaneSplit}
        sizesByGroupId={{}}
        PaneComponent={StubPane}
        onResizeGroup={() => undefined}
        isMobile={false}
      />,
    );
    expect(queryByTestId("tile-mobile-stack")).toBeNull();
    // The split group renders its axis marker; resize handles live inside it.
    expect(container.querySelector('[data-axis="horizontal"]')).not.toBeNull();
  });

  it("collapses a multi-pane split into a single scrollable stack on mobile", () => {
    const { container, getAllByTestId, getByTestId } = render(
      <SplitContainer
        root={twoPaneSplit}
        sizesByGroupId={{}}
        PaneComponent={StubPane}
        onResizeGroup={() => undefined}
        isMobile
      />,
    );
    expect(getByTestId("tile-mobile-stack")).toBeTruthy();
    // Both panes still render (each keeps its own tab strip), but there is no
    // split group — so no side-by-side layout and no drag resize handles.
    expect(getAllByTestId("pane")).toHaveLength(2);
    expect(container.querySelector("[data-axis]")).toBeNull();
  });

  it("renders a single pane directly on mobile, identical to desktop", () => {
    const { queryByTestId, getAllByTestId } = render(
      <SplitContainer
        root={pane("solo")}
        sizesByGroupId={{}}
        PaneComponent={StubPane}
        onResizeGroup={() => undefined}
        isMobile
      />,
    );
    // No stack wrapper for the common single-pane case.
    expect(queryByTestId("tile-mobile-stack")).toBeNull();
    expect(getAllByTestId("pane")).toHaveLength(1);
  });
});
