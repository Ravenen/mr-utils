import type { Feature } from "@/core/lifecycle";
import { mrListFeature } from "./mr-list";
import { approvalGuardFeature } from "./mr-page/approval-guard";
import { hunkReviewFeature } from "./mr-page/hunk-review";
import { seenStateFeature } from "./mr-page/seen-state";

// Every feature of the content script; the router mounts the ones matching the page
export const features: Feature[] = [mrListFeature, seenStateFeature, approvalGuardFeature, hunkReviewFeature];
