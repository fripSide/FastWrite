#!/usr/bin/env bun

import { Command } from "commander";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AcademicWritingHelper } from "./writer.js";
import {
  deriveProjectNameFromSectionsDir,
  getProjects,
  loadProjectConfig,
  registerProject,
  switchProject
} from "./projectConfig.js";

const program = new Command();

program
  .name("fastwrite")
  .description("Academic writing helper for LaTeX papers")
  .version("1.0.0");

program
  .command("prepare")
  .alias("p")
  .description("Register/activate a project and generate prompt templates")
  .argument("[project-name]", "Project name (optional)")
  .argument("<sections-dir>", "Path to sections directory containing {id}-{name}.tex files")
  .action((projectName: string | undefined, sectionsDir: string) => {
    const absSectionsDir = resolve(sectionsDir);
    if (!existsSync(absSectionsDir)) {
      console.error(`Sections directory does not exist: ${absSectionsDir}`);
      process.exit(1);
    }

    const name = projectName?.trim() || deriveProjectNameFromSectionsDir(absSectionsDir);
    // projs dir at current working directory (root)
    const projDir = join(process.cwd(), "projs", name);

    registerProject({ projectName: name, sectionsDir: absSectionsDir, projDir });

    const helper = new AcademicWritingHelper();
    const sections = helper.scanSections();
    helper.generateMarkdownPrompts(sections);

    console.log(`Prepared project: ${name}`);
    console.log(`  Sections: ${absSectionsDir}`);
    console.log(`  Proj: ${projDir}`);
  });

program
  .command("switch")
  .alias("s")
  .description("Switch current project")
  .argument("<project-name>", "Project name")
  .action((projectName: string) => {
    const project = switchProject(projectName);
    if (!project) {
      console.error(`Project '${projectName}' not found.`);
      const projects = Object.keys(getProjects());
      if (projects.length) console.error(`Available: ${projects.join(", ")}`);
      process.exit(1);
    }

    console.log(`Switched to project: ${projectName}`);
    console.log(`  Sections: ${project.sections_dir}`);
    console.log(`  Proj: ${project.proj_dir}`);
  });

program
  .command("write")
  .alias("w")
  .description("Rewrite a section using LLM based on the prompt requirements, then generate an HTML diff")
  .argument("<section-id>", "Section ID to write (e.g., 0 targets 0-*.tex)")
  .option("-k, --api-key <key>", "LLM API key (overrides OPENAI_API_KEY env var)")
  .option("-v, --verbose", "Print system prompt and user content")
  .action(async (sectionId: string, options: { apiKey?: string; verbose?: boolean }) => {
    try {
      const id = Number.parseInt(sectionId, 10);
      if (Number.isNaN(id)) throw new Error("Invalid section ID");

      const helper = new AcademicWritingHelper();
      const diffPath = await helper.processSection(id, options.apiKey, options.verbose);
      console.log("Section written successfully!");
      console.log(`Diff: ${diffPath}`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("clean")
  .alias("c")
  .description("Clear backup and diff files from current project")
  .action(() => {
    const active = loadProjectConfig();
    if (!active) {
      console.error("No active project. Run 'fastwrite prepare' first.");
      process.exitCode = 1;
      return;
    }

    const clearDir = (name: string): number => {
      const dir = join(active.project.proj_dir, name);
      if (!existsSync(dir)) return 0;
      const files = readdirSync(dir);
      files.forEach(f => rmSync(join(dir, f)));
      return files.length;
    };

    const backupCount = clearDir("backups");
    const diffCount = clearDir("diffs");

    console.log(`Cleaned project: ${active.name}`);
    console.log(`  Removed ${backupCount} backup(s), ${diffCount} diff(s)`);
  });

program.parse();

