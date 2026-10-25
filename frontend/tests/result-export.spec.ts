import { expect, test } from "@playwright/test";
import { partDimensionSvg } from "../src/domain/project/result-export";

test("SVG adds both dimensions of an L-shaped door-reveal cut", () => {
  const svg = partDimensionSvg([
    [0, 0], [450, 0], [450, 600], [20, 600], [20, 490], [0, 490],
  ]);

  expect(svg.match(/data-part-dimension/g)).toHaveLength(6);
  expect(svg).toContain(">450 мм</text>");
  expect(svg).toContain(">600 мм</text>");
  expect(svg).toContain(">110 мм</text>");
  expect(svg).toContain(">20 мм</text>");
  expect(svg).toContain(">490 мм</text>");
});
