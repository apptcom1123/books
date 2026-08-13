(() => {
  const SCORE_DURATION = 420;
  const CARD_SWAP_DURATION = 1000;
  const easing = "cubic-bezier(.22,.72,.2,1)";

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function capturePositions(root, selector = "[data-social-key]") {
    const positions = new Map();
    if (!root) return positions;
    root.querySelectorAll(selector).forEach((node) => {
      const key = node.dataset.socialKey;
      if (key) positions.set(key, node.getBoundingClientRect());
    });
    return positions;
  }

  function animateCardSwap(root, positions, selector = "[data-social-key]") {
    if (!root || !positions?.size || reducedMotion()) return;
    const nodes = [...root.querySelectorAll(selector)];
    const moves = new Map();
    nodes.forEach((node) => {
      const previous = positions.get(node.dataset.socialKey);
      if (!previous) return;
      const current = node.getBoundingClientRect();
      moves.set(node, { x:previous.left - current.left, y:previous.top - current.top });
    });
    nodes.forEach((node) => {
      const move = moves.get(node);
      if (!move) return;
      const parent = node.parentElement?.closest(selector);
      const parentMove = parent ? moves.get(parent) : null;
      const x = move.x - (parentMove?.x || 0);
      const y = move.y - (parentMove?.y || 0);
      if (Math.abs(x) < 1 && Math.abs(y) < 1 || typeof node.animate !== "function") return;
      node.animate(
        [{ transform:`translate3d(${x}px,${y}px,0)` }, { transform:"translate3d(0,0,0)" }],
        { duration:CARD_SWAP_DURATION, easing, fill:"both" },
      );
    });
  }

  function animateScores(root = document) {
    root.querySelectorAll("[data-score-from][data-score-to]").forEach((node) => {
      const from = Number(node.dataset.scoreFrom);
      const to = Number(node.dataset.scoreTo);
      delete node.dataset.scoreFrom;
      delete node.dataset.scoreTo;
      const format = (value) => node.dataset.scoreSigned === "false" ? String(value) : `${value >= 0 ? "+" : ""}${value}`;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || reducedMotion()) {
        node.textContent = format(to);
        return;
      }
      const increase = to > from;
      const windowNode = document.createElement("span");
      const track = document.createElement("span");
      const first = document.createElement("span");
      const second = document.createElement("span");
      windowNode.className = "social-score-window";
      track.className = "social-score-track";
      first.textContent = format(increase ? from : to);
      second.textContent = format(increase ? to : from);
      track.append(first, second);
      windowNode.append(track);
      node.replaceChildren(windowNode);
      if (typeof track.animate !== "function") {
        node.textContent = format(to);
        return;
      }
      const frames = increase
        ? [{ transform:"translateY(0)" }, { transform:"translateY(-50%)" }]
        : [{ transform:"translateY(-50%)" }, { transform:"translateY(0)" }];
      const animation = track.animate(frames, { duration:SCORE_DURATION, easing, fill:"both" });
      animation.finished.then(() => { if (node.isConnected) node.textContent = format(to); }).catch(() => {});
    });
  }

  window.librarySocialMotion = Object.freeze({
    SCORE_DURATION,
    CARD_SWAP_DURATION,
    capturePositions,
    animateCardSwap,
    animateScores,
  });
})();
