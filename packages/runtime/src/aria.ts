import type { Locator, Page } from "@playwright/test";

import type { LazyLocator, Mount } from "./locator.js";
import {
  button,
  listbox,
  menu as menuRole,
  menuitem,
  option as optionLeaf,
  radio as radioLeaf,
  radiogroup,
  resolveLocator,
  tab as tabLeaf,
  tabpanel as tabpanelLeaf,
  textbox,
} from "./locator.js";
import type {
  AnySurface,
  Component,
  Overlay,
  OverlayFactory,
  Rooted,
  RootedComponent,
  Surface,
  SurfaceInstance,
} from "./pom.js";
import { defineComponent, defineDialog, defineOverlay, rootOf } from "./pom.js";

export interface Menu<Action extends string> extends Overlay<{
  item: (action: Action) => Locator;
}> {
  choose: (action: Action) => Promise<void>;
}

export interface MenuFactory {
  <Action extends string>(
    name: string | RegExp,
    options?: { label?: string },
  ): OverlayFactory<Menu<Action>>;
  parameterized: true;
}

function labelOf(name: string | RegExp, label: string | undefined): string {
  if (label !== undefined) {
    return label;
  }

  if (typeof name === "string") {
    return name;
  }

  throw new Error(
    `the ${name.source} menu needs a label: its name is a pattern`,
  );
}

export const menu = defineOverlay(
  (name: string | RegExp, options?: { label?: string }) => ({
    root: menuRole(name),
    recorder: { label: labelOf(name, options?.label) },
    elements: {
      item: (action: string): LazyLocator => menuitem(action),
    },
    actions: {
      async choose(action: string): Promise<void> {
        await this.open();
        await this.elements.item(action).click();
        await this.waitFor("hidden");
      },
    },
  }),
) as unknown as MenuFactory;

async function selectTab(tab: Locator): Promise<void> {
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
}

export interface TabsElements<N extends string> {
  names: () => readonly N[];
  tab: (n: N) => LazyLocator;
  tabPanel: (n: N) => LazyLocator;
  select: (n: N) => (scope: Mount) => Promise<void>;
}

export const tabs = <const N extends string>(
  names: readonly N[],
): TabsElements<N> => ({
  names: (): readonly N[] => names,
  tab: (n: N): LazyLocator => tabLeaf(n),
  tabPanel: (n: N): LazyLocator => tabpanelLeaf(n),
  select:
    (n: N) =>
    async (scope: Mount): Promise<void> => {
      await selectTab(resolveLocator(scope, tabLeaf(n).chain));
      await resolveLocator(scope, tabpanelLeaf(n).chain).waitFor();
    },
});

export type RadioGroup<Option extends string> = RootedComponent<
  { radio: (option: Option) => Locator },
  { select: (option: Option) => Promise<void> }
>;

export interface RadioGroupFactory {
  <Option extends string>(name: string): Surface<RadioGroup<Option>>;
  parameterized: true;
}

export const radioGroup = defineComponent((name: string) => ({
  root: radiogroup(name),
  elements: {
    radio: (option: string): LazyLocator => radioLeaf(option),
  },
  actions: {
    async select(option: string): Promise<void> {
      await this.elements.radio(option).check();
    },
  },
})) as unknown as RadioGroupFactory;

const comboboxOptions = defineOverlay({
  root: listbox(),
  recorder: { label: "Options" },
  elements: {
    option: (name: string): LazyLocator => optionLeaf(name),
  },
});

export type ComboboxOptions<Value extends string> = Overlay<{
  option: (value: Value) => Locator;
}>;

export type SelectCombobox<Value extends string> = RootedComponent<
  { options: ComboboxOptions<Value> },
  { ensureSelected: (value: Value) => Promise<void> }
>;

export type SelectComboboxFactory = <Value extends string>(
  scope: LazyLocator,
) => Surface<SelectCombobox<Value>>;

export const selectCombobox = defineComponent({
  elements: {
    options: comboboxOptions,
  },
  actions: {
    async ensureSelected(value: string): Promise<void> {
      await rootOf(this).click();
      await this.elements.options.elements.option(value).click();
    },
  },
}) as unknown as SelectComboboxFactory;

export type MultiCombobox<Value extends string> = RootedComponent<
  {
    options: ComboboxOptions<Value>;
    selectedTag: (value: Value) => Locator;
  },
  {
    ensureSelected: (
      values: readonly Value[],
      allValues?: readonly Value[],
    ) => Promise<void>;
  }
>;

export interface MultiComboboxFactory {
  <Value extends string>(
    selectedTag: (value: Value) => LazyLocator,
  ): (scope: LazyLocator) => Surface<MultiCombobox<Value>>;
  parameterized: true;
}

export const multiCombobox = defineComponent(
  (selectedTag: (value: string) => LazyLocator) => ({
    elements: {
      options: comboboxOptions,
      selectedTag,
    },
    actions: {
      async ensureSelected(
        values: readonly string[],
        allValues: readonly string[] = [],
      ): Promise<void> {
        const root = rootOf(this);
        const { options, selectedTag } = this.elements;

        await root.click();

        for (const value of values) {
          const option = options.elements.option(value);
          if ((await option.getAttribute("aria-selected")) !== "true") {
            await option.click();
          }
        }

        await root.press("Escape");

        for (const value of values) {
          await selectedTag(value).waitFor();
        }

        for (const value of allValues.filter((it) => !values.includes(it))) {
          const tag = selectedTag(value);
          if (!(await tag.isVisible())) {
            continue;
          }

          await root.click();
          await options.elements.option(value).click();
          await root.press("Escape");
          await tag.waitFor({ state: "hidden" });
        }
      },
    },
  }),
) as unknown as MultiComboboxFactory;

export const freeCombobox = defineComponent({
  actions: {
    async ensureSelected(values: readonly string[]): Promise<void> {
      const root = rootOf(this);

      for (const value of values) {
        await root.fill(value);
        await root.press("Enter");
      }

      await root.press("Escape");
    },
  },
});

export type Disclosure<Panel = Locator> = Component<
  { trigger: Locator; panel: Panel },
  { expand: () => Promise<void>; collapse: () => Promise<void> }
>;

export interface DisclosureFactory {
  (trigger: LazyLocator, panel: LazyLocator): Surface<Disclosure>;
  <I extends SurfaceInstance>(
    trigger: LazyLocator,
    panel: LazyLocator,
    contents: Surface<I>,
  ): Surface<Disclosure<I & Rooted>>;
}

export const disclosure = ((
  trigger: LazyLocator,
  panel: LazyLocator,
  contents?: AnySurface,
): AnySurface => {
  const within = panel.within(trigger);

  return defineComponent({
    elements: {
      trigger,
      panel: contents === undefined ? within : contents(within),
    },
    actions: {
      async expand(): Promise<void> {
        const { trigger } = this.elements;
        const expanded = trigger.and(
          this.page.locator('[aria-expanded="true"]'),
        );
        const collapsed = trigger.and(
          this.page.locator('[aria-expanded="false"]'),
        );

        await expanded.or(collapsed).waitFor();

        if ((await expanded.count()) > 0) {
          return;
        }

        await trigger.click();
        await expanded.waitFor();
      },
      async collapse(): Promise<void> {
        const { trigger } = this.elements;
        const expanded = trigger.and(
          this.page.locator('[aria-expanded="true"]'),
        );
        const collapsed = trigger.and(
          this.page.locator('[aria-expanded="false"]'),
        );

        await expanded.or(collapsed).waitFor();

        if ((await collapsed.count()) > 0) {
          return;
        }

        await trigger.click();
        await collapsed.waitFor();
      },
    },
  });
}) as unknown as DisclosureFactory;

export const confirmDelete = defineDialog(
  (def: {
    name: string;
    confirmLabel: string;
    cancelLabel: string;
    confirmed?: (page: Page) => Promise<void>;
  }) => ({
    name: def.name,
    close: { button: button(def.cancelLabel) },
    elements: {
      confirmTextbox: textbox(def.confirmLabel),
      deleteButton: button(def.name),
      cancelButton: button(def.cancelLabel),
    },
    actions: {
      async confirm(name: string): Promise<void> {
        await this.elements.confirmTextbox.fill(name);
        await this.elements.deleteButton.click();
        await this.root.waitFor({ state: "hidden", timeout: 15_000 });
        await def.confirmed?.(this.page);
      },
    },
  }),
);
