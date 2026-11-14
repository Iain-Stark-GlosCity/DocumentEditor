/**
 * A linear-text approximation of an Office Math (OMML) equation, close to what Word's own
 * "Linear" format shows: `(a+b)/c`, `x^(2)`, `√(x)`, `∑_(i=1)^(n) i`. The full XML is always shown
 * next to it, so this only needs to be readable, not exact.
 */
import { child, elements, localName, textOf, type XElement } from "./xml";

function arg(el: XElement | undefined): string {
  if (!el) return "";
  const text = linearMath(el);
  return /^[\p{L}\p{N}.]+$/u.test(text) ? text : `(${text})`;
}

function chr(el: XElement, prop: string, name: string, fallback: string): string {
  const v = child(child(el, prop), name)?.attrs["m:val"];
  return v === undefined ? fallback : v;
}

export function linearMath(el: XElement): string {
  switch (el.name) {
    case "m:r":
      return (
        textOf(child(el, "m:t")) ||
        elements(el)
          .filter((c) => c.name === "m:t")
          .map(textOf)
          .join("")
      );
    case "m:t":
      return textOf(el);
    case "m:f": {
      const type = child(child(el, "m:fPr"), "m:type")?.attrs["m:val"];
      return `${arg(child(el, "m:num"))}${type === "lin" ? "/" : type === "noBar" ? "¦" : "/"}${arg(child(el, "m:den"))}`;
    }
    case "m:sSup":
      return `${linearMath(child(el, "m:e") ?? el)}^${arg(child(el, "m:sup"))}`;
    case "m:sSub":
      return `${linearMath(child(el, "m:e") ?? el)}_${arg(child(el, "m:sub"))}`;
    case "m:sSubSup":
      return `${linearMath(child(el, "m:e") ?? el)}_${arg(child(el, "m:sub"))}^${arg(child(el, "m:sup"))}`;
    case "m:sPre":
      return `_${arg(child(el, "m:sub"))}^${arg(child(el, "m:sup"))}${linearMath(child(el, "m:e") ?? el)}`;
    case "m:rad": {
      const deg = child(el, "m:deg");
      const degText = deg ? linearMath(deg) : "";
      return degText
        ? `√(${degText}&${linearMath(child(el, "m:e") ?? el)})`
        : `√${arg(child(el, "m:e"))}`;
    }
    case "m:nary": {
      const op = chr(el, "m:naryPr", "m:chr", "∫");
      const sub = child(el, "m:sub");
      const sup = child(el, "m:sup");
      const subText = sub ? linearMath(sub) : "";
      const supText = sup ? linearMath(sup) : "";
      return `${op}${subText ? `_${arg(sub)}` : ""}${supText ? `^${arg(sup)}` : ""} ${linearMath(child(el, "m:e") ?? el)}`;
    }
    case "m:d": {
      const beg = chr(el, "m:dPr", "m:begChr", "(");
      const end = chr(el, "m:dPr", "m:endChr", ")");
      const sep = chr(el, "m:dPr", "m:sepChr", "|");
      return `${beg}${elements(el)
        .filter((c) => c.name === "m:e")
        .map(linearMath)
        .join(sep)}${end}`;
    }
    case "m:func":
      return `${linearMath(child(el, "m:fName") ?? el)}${arg(child(el, "m:e"))}`;
    case "m:limLow":
      return `${linearMath(child(el, "m:e") ?? el)}_${arg(child(el, "m:lim"))}`;
    case "m:limUpp":
      return `${linearMath(child(el, "m:e") ?? el)}^${arg(child(el, "m:lim"))}`;
    case "m:acc":
      return `${arg(child(el, "m:e"))}${chr(el, "m:accPr", "m:chr", "\u0302")}`;
    case "m:bar":
      return `¯${arg(child(el, "m:e"))}`;
    case "m:eqArr":
      return `■(${elements(el)
        .filter((c) => c.name === "m:e")
        .map(linearMath)
        .join("@")})`;
    case "m:m":
      return `■(${elements(el)
        .filter((c) => c.name === "m:mr")
        .map((r) =>
          elements(r)
            .filter((c) => c.name === "m:e")
            .map(linearMath)
            .join("&"),
        )
        .join("@")})`;
  }
  if (localName(el.name).endsWith("Pr") || el.name === "w:rPr") return "";
  return elements(el)
    .map(linearMath)
    .join(el.name === "m:oMathPara" ? " " : "");
}
