import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCoordinator, requireUser } from "./lib/auth";

const modeValidator = v.union(v.literal("sync"), v.literal("async"));

/** Full dutyTypes doc validator (shared with ta.getSchedule). */
export const dutyTypeDoc = v.object({
  _id: v.id("dutyTypes"),
  _creationTime: v.number(),
  periodRef: v.id("staffingPeriods"),
  name: v.string(),
  mode: modeValidator,
  color: v.string(),
  defaultHoursCredit: v.number(),
});

/**
 * Duty types of a period. Readable by the owning coordinator OR a TA with a
 * profile in the period (TAs need names/colors to rank dutyTypePrefs).
 */
export const list = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(dutyTypeDoc),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const period = await ctx.db.get(args.periodRef);
    if (!period) throw new Error("Staffing period not found");
    const isOwner =
      user.role === "coordinator" && period.coordinatorRef === user._id;
    if (!isOwner) {
      const profile = await ctx.db
        .query("taProfiles")
        .withIndex("by_user_period", (q) =>
          q.eq("userRef", user._id).eq("periodRef", args.periodRef),
        )
        .unique();
      if (!profile) throw new Error("Not authorized for this period");
    }
    return await ctx.db
      .query("dutyTypes")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
  },
});

export const create = mutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    name: v.string(),
    mode: modeValidator,
    color: v.string(),
    defaultHoursCredit: v.number(),
  },
  returns: v.id("dutyTypes"),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    if (args.name.trim().length === 0) throw new Error("Name is required");
    if (args.defaultHoursCredit < 0) {
      throw new Error("defaultHoursCredit must be >= 0");
    }
    return await ctx.db.insert("dutyTypes", {
      periodRef: args.periodRef,
      name: args.name.trim(),
      mode: args.mode,
      color: args.color,
      defaultHoursCredit: args.defaultHoursCredit,
    });
  },
});

export const update = mutation({
  args: {
    dutyTypeRef: v.id("dutyTypes"),
    name: v.optional(v.string()),
    mode: v.optional(modeValidator),
    color: v.optional(v.string()),
    defaultHoursCredit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dutyType = await ctx.db.get(args.dutyTypeRef);
    if (!dutyType) throw new Error("Duty type not found");
    await requireCoordinator(ctx, dutyType.periodRef);

    if (args.mode !== undefined && args.mode !== dutyType.mode) {
      // Changing sync<->async would invalidate the shape of existing shifts.
      const shifts = await ctx.db
        .query("shifts")
        .withIndex("by_period", (q) => q.eq("periodRef", dutyType.periodRef))
        .collect();
      if (shifts.some((s) => s.dutyTypeRef === dutyType._id)) {
        throw new Error(
          "Cannot change mode while shifts reference this duty type",
        );
      }
    }
    if (args.name !== undefined && args.name.trim().length === 0) {
      throw new Error("Name cannot be empty");
    }
    if (args.defaultHoursCredit !== undefined && args.defaultHoursCredit < 0) {
      throw new Error("defaultHoursCredit must be >= 0");
    }

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.mode !== undefined) patch.mode = args.mode;
    if (args.color !== undefined) patch.color = args.color;
    if (args.defaultHoursCredit !== undefined) {
      patch.defaultHoursCredit = args.defaultHoursCredit;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(dutyType._id, patch);
    }
    return null;
  },
});

export const remove = mutation({
  args: { dutyTypeRef: v.id("dutyTypes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dutyType = await ctx.db.get(args.dutyTypeRef);
    if (!dutyType) throw new Error("Duty type not found");
    await requireCoordinator(ctx, dutyType.periodRef);
    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", dutyType.periodRef))
      .collect();
    if (shifts.some((s) => s.dutyTypeRef === dutyType._id)) {
      throw new Error(
        "Cannot delete: shifts still reference this duty type. Delete or reassign those shifts first.",
      );
    }
    await ctx.db.delete(dutyType._id);
    return null;
  },
});
