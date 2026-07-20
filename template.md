# E.Y.E.S. — Notification Templates Reference (Categorized)

This document organizes and categorizes the exact email templates used by the AI Agent to notify CSPs, RMs, DCs, and Joint Escalation targets.

---

## 1. CSP (Customer Service Point / Terminal Owner)

> [!NOTE]
> CSPs do not have email addresses registered in the default source directory. If email notifications are enabled for CSPs in the future, the following format is designed to be sent directly to them.

### 📧 CSP Direct Inactivity Email
* **Trigger:** CSP has been inactive for $\ge 3$ days (nudge tier).
* **Subject:** `Action Required: Your Eko terminal is inactive`
* **Content Template:**
  ```text
  Hello [Name],

  We noticed your Eko CSP terminal ([CspCode]) has not been used for [Days] days. 

  Is everything OK? 
  * If you are facing any device issues, shop closure, or need support, reply/email HELP and our team will call you.
  * If everything is fine, simply perform a single transaction today to reactivate your terminal.

  -- E.Y.E.S. (EKO Yield & Escalation System)
  ```

---

## 2. RM (Relationship Manager)

RMs receive consolidated digests containing all their assigned CSPs who are inactive for **8 to 15 days** (and higher tiers for visibility). RMs are the primary owners for the initial breach follow-up.

### 📧 RM Inactivity Digest Email
* **Trigger:** Run daily at the scheduled cron time.
* **Subject:** `Action required: inactivity digest (RM)`
* **Content Template:**
  ```text
  Inactivity digest for you as RM.
  [Count] CSP(s) need your attention.

  RM FOLLOW-UP — Inactive over 7 days — RM follow-up required
    • [Name] ([CspCode]) — [Days] days inactive

  Target: keep inactivity at or below 2%.

  -- E.Y.E.S. (EKO Yield & Escalation System)
  ```

---

## 3. DC (Department Coordinator)

DCs are department-level coordinators. They are looped in for department-wide visibility once a CSP's inactivity reaches **16 to 23 days** (escalated tier) or **24+ days** (critical tier).

### 📧 DC Inactivity Digest Email
* **Trigger:** Run daily at the scheduled cron time.
* **Subject:** `Action required: inactivity digest (DC)`
* **Content Template:**
  ```text
  Inactivity digest for you as DC.
  [Count] CSP(s) need your attention.

  RM + DC — Inactive over 15 days — RM and DC follow-up required
    • [Name] ([CspCode]) — [Days] days inactive

  CRITICAL — Inactive over 23 days — Urgent daily follow-up by RM and DC
    • [Name] ([CspCode]) — [Days] days inactive

  Target: keep inactivity at or below 2%.

  -- E.Y.E.S. (EKO Yield & Escalation System)
  ```

---

## 4. RM + DC (Joint Escalation)

When a terminal remains inactive for **16 or more days**, the notification escalates to a joint responsibility. Both the assigned Relationship Manager (RM) and Department Coordinator (DC) receive identical copies of these records in their respective daily digests to ensure coordination.

### 📧 Joint Escalation Section (Included in both RM & DC emails)
* **Trigger:** Inactivity duration $\ge 16$ days (escalated & critical tiers).
* **Content Format:**
  ```text
  === JOINT ESCALATION (RM + DC) ===

  RM + DC — Inactive over 15 days — RM and DC follow-up required
    • [Name] ([CspCode]) — [Days] days inactive

  CRITICAL — CRITICAL — inactive 23+ days, urgent daily follow-up by RM and DC
    • [Name] ([CspCode]) — [Days] days inactive
  ```
