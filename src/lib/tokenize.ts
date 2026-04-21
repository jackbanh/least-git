import { tokenize } from "react-diff-view";
import type { HunkData, HunkTokens } from "react-diff-view";
import refractor from "refractor/core";
import clike from "refractor/lang/clike";
import javascript from "refractor/lang/javascript";
import jsx from "refractor/lang/jsx";
import typescript from "refractor/lang/typescript";
import tsx from "refractor/lang/tsx";
import rust from "refractor/lang/rust";
import python from "refractor/lang/python";
import go from "refractor/lang/go";
import java from "refractor/lang/java";
import css from "refractor/lang/css";
import json from "refractor/lang/json";
import yaml from "refractor/lang/yaml";
import bash from "refractor/lang/bash";
import markdown from "refractor/lang/markdown";
import toml from "refractor/lang/toml";
import c from "refractor/lang/c";
import cpp from "refractor/lang/cpp";
import swift from "refractor/lang/swift";
import kotlin from "refractor/lang/kotlin";

// Order matters: dependencies must be registered before dependents.
const langs = [clike, javascript, jsx, typescript, tsx, rust, python, go,
  java, css, json, yaml, bash, markdown, toml, c, cpp, swift, kotlin];

for (const lang of langs) {
  try { refractor.register(lang); } catch { /* already registered */ }
}

export function tokenizeHunks(hunks: HunkData[], language: string): HunkTokens {
  return tokenize(hunks, { highlight: true, refractor, language }) as HunkTokens;
}
