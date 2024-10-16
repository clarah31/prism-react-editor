import { useEffect, useMemo } from 'react';
import { InputSelection, PrismEditor } from '../..';
import { addTextareaListener, preventDefault, useStableRef } from '../../core';
import { useTooltip } from '../../tooltips';
import {
  getLanguage,
  getLineBefore,
  getModifierCode,
  insertText,
  prevSelection,
  setSelection,
} from '../../utils';
import { createTemplate } from '../../utils/local';
import { getStyleValue } from '../../utils/other';
import { Cursor, useCursorPosition } from '../cursor';
import { searchTemplate } from '../search/search';
import {
  AutoCompleteConfig,
  Completion,
  CompletionContext,
  CompletionDefinition,
} from './types';
import { updateMatched, updateNode } from './utils';

let count = 0;

const tooltipTemplate = createTemplate(
  '<div class=pce-ac-tooltip><ul role=listbox>'
);
const rowTemplate = createTemplate(
  '<li class=pce-ac-row role=option><div></div><div> </div><div class=pce-ac-details> '
);

const map: Record<string, CompletionDefinition<any>> = {};

/**
 * Registers completion sources for a set of languages.
 * If any of the languages already have completion sources, they're overridden.
 * @param langs Array of languages you want the completions to apply for.
 * @param definition Defines the completion sources for the languages along with additional
 * properties on the context passed to the completion sources.
 */
const registerCompletions = <T extends object>(
  langs: string[],
  definition: CompletionDefinition<T>
) => {
  langs.forEach((lang) => (map[lang] = definition));
};

/**
 * Extension adding basic autocomplete to an editor. For autocompletion to work, you need to
 * {@link registerCompletions} for specific languages.
 *
 * @param config Object used to configure the extension. The `filter` property is required.
 *
 * Requires the {@link useCursorPosition} extension to work.
 *
 * Requires styling from `solid-prism-editor/autocomplete.css`. Also requires a stylesheet
 * for icons. `solid-prism-editor/autocomplete-icons.css` adds some icons from VSCode, but
 * you can define your own icons instead.
 *
 * @see {@link Completion.icon} for how to style your own icons.
 */
const useAutoComplete = (editor: PrismEditor, config: AutoCompleteConfig) => {
  const _config = useStableRef([config]);
  const tooltip = useMemo(tooltipTemplate, []);
  const [show, _hide] = useTooltip(editor, tooltip);

  _config[0] = config;

  useEffect(() => {
    let isOpen: boolean;
    let shouldOpen: boolean;
    let currentOptions: [number, number[], number, number, Completion][];
    let numOptions: number;
    let activeIndex: number;
    let active: HTMLLIElement | undefined;
    let pos: number;
    let offset: number;
    let rowHeight: number;
    let cursor: Cursor | undefined;
    let stops: null | number[];
    let activeStop: number;
    let currentSelection: InputSelection;
    let prevLength: number;
    let isDeleteForwards: boolean;

    const windowSize = 6;
    const textarea = editor.textarea!;
    const getSelection = editor.getSelection;
    const tabStopsContainer = searchTemplate();

    const list = tooltip.firstChild as HTMLUListElement;
    const id = (list.id = 'pce-ac-' + count++);
    const rows = list.children as HTMLCollectionOf<HTMLLIElement>;
    const prevIcons: string[] = [];
    const hide = () => {
      if (isOpen) {
        _hide();
        textarea.removeAttribute('aria-haspopup');
        textarea.removeAttribute('aria-activedescendant');
        isOpen = false;
      }
    };

    const measureRowHeight = () => {
      rowHeight = getStyleValue(rows[0], 'height');
    };

    const updateRow = (index: number) => {
      const option = currentOptions[index + offset];
      //@ts-ignore
      const [iconEl, labelEl, detailsEl] = rows[index]
        .children as HTMLCollectionOf<HTMLDivElement>;
      const completion = option[4];
      const icon = completion.icon || 'variable';

      updateMatched(labelEl, option[1], completion.label);
      updateNode(detailsEl.firstChild as Text, completion.detail || '');

      if (prevIcons[index] != icon) {
        iconEl.className = `pce-ac-icon pce-ac-icon-${(prevIcons[index] = icon)}`;
        iconEl.style.color = `var(--pce-ac-icon-${icon})`;
      }
    };

    const scrollActiveIntoView = () => {
      measureRowHeight();
      // AUIT
      let h = 0;
      for (let i = 0; i < activeIndex; i++) {
        h += getStyleValue(rows[i], 'height');
      }
      const scrollTop = tooltip.scrollTop;
      const lower = rowHeight * activeIndex;
      const upper = rowHeight * (activeIndex + 1) - tooltip.clientHeight;

    //   tooltip.scrollTop =
    //     scrollTop > lower ? lower : scrollTop < upper ? upper : scrollTop;
      tooltip.scrollTop = h
    };

    const updateActive = () => {
      const newActive = rows[activeIndex - offset];
      if (newActive != active) {
        active?.removeAttribute('aria-selected');
        if (newActive) {
          textarea.setAttribute('aria-activedescendant', newActive.id);
          newActive.setAttribute('aria-selected', true as any);
        } else {
          textarea.removeAttribute('aria-activedescendant');
        }
        active = newActive;
      }
    };

    const move = (decrement?: boolean) => {
      if (decrement)
        activeIndex = activeIndex ? activeIndex - 1 : numOptions - 1;
      else activeIndex = activeIndex + 1 < numOptions ? activeIndex + 1 : 0;
      scrollActiveIntoView();
      updateActive();
    };

    const insertOption = (index: number) => {
      if (editor.props.readOnly) return;
      let [, , start, end, completion] = currentOptions[index];
      let { label, tabStops: tabStops = [], insert } = completion;
      let l = tabStops.length;
      tabStops = tabStops.map((stop) => stop + start);

      if (insert) {
        let indent = '\n' + getLineBefore(editor.value, pos).match(/\s*/)![0];
        let tab =
          editor.props.insertSpaces == false
            ? '\t'
            : ' '.repeat(editor.props.tabSize || 2);
        let temp = tabStops.slice();

        insert = insert.replace(/\n|\t/g, (match, index: number) => {
          let replacement = match == '\t' ? tab : indent;
          let diff = replacement.length - 1;
          let i = 0;
          while (i < l) {
            if (temp[i] > index + start) tabStops[i] += diff;
            i++;
          }

          return replacement;
        });
      } else insert = label;

      if (l % 2) tabStops[l] = tabStops[l - 1];

      insertText(editor, insert, start, end, tabStops[0], tabStops[1]);

      if (l > 2) {
        stops = tabStops;
        activeStop = 0;
        prevLength = editor.value.length;
        updateStops();
        currentSelection = getSelection();
        if (!tabStopsContainer.parentNode)
          editor.lines![0].append(tabStopsContainer);
      }
      cursor!.scrollIntoView();
    };

    const moveActiveStop = (offset: number) => {
      activeStop += offset;
      setSelection(editor, stops![activeStop], stops![activeStop + 1]);
      cursor!.scrollIntoView();
    };

    const clearStops = () => {
      tabStopsContainer.remove();
      stops = null;
    };

    const updateStops = () => {
      let sorted: [number, number][] = [];
      let i = 0;
      for (; i < stops!.length; ) sorted[i / 2] = [stops![i++], stops![i++]];
      sorted.sort((a, b) => a[0] - b[0]);
      updateMatched(tabStopsContainer, sorted.flat(), editor.value);
    };

    const startQuery = (explicit = false) => {
      const [start, end, dir] = getSelection();
      const language = getLanguage(editor, (pos = dir < 'f' ? start : end));
      const definition = map[language];
      if (definition && (explicit || start == end) && !editor.props.readOnly) {
        const value = editor.value;
        const lineBefore = getLineBefore(value, pos);
        const before = value.slice(0, pos);
        const context: CompletionContext = {
          before,
          lineBefore,
          language,
          explicit,
          pos,
        };
        const newContext = Object.assign(
          context,
          definition.context?.(context, editor)
        );
        const filter = _config[0].filter;

        currentOptions = [];
        definition.sources.forEach((source) => {
          const result = source(newContext, editor);
          if (result) {
            const from = result.from;
            const query = before.slice(from);

            result.options.forEach((option) => {
              const filterResult = filter(query, option.label);
              if (filterResult) {
                filterResult[0] += option.boost || 0;
                // @ts-expect-error Allow mutation
                filterResult.push(from, result.to ?? end, option);
                // @ts-expect-error Allow mutation
                currentOptions.push(filterResult);
              }
            });
          }
        });

        if (currentOptions[0]) {
          //AUIT currentOptions.sort((a, b) => b[0] - a[0] || a[4].label.localeCompare(b[4].label))
          numOptions = currentOptions.length;
          activeIndex = offset = 0;

          for (
            let i = 0, l = numOptions < windowSize ? numOptions : windowSize;
            i < l;

          ) {
            updateRow(i++);
          }

          if (!isOpen) {
            const { clientHeight, clientWidth } = editor.container!;
            const pos = cursor!.getPosition();
            const max = Math.max(pos.bottom, pos.top);
            tooltip.style.width = `min(25em, ${clientWidth}px - var(--padding-left) - 1em)`;
            tooltip.style.width = `300px`;
            
            // AUIT

            tooltip.style.maxHeight = '200px'; //`min(17em, ${max}px + .25em, ${clientHeight}px - 2em)`
          }

          list.style.paddingTop = '';
          //list.style.height = rowHeight ? rowHeight * numOptions + "px" : 1.4 * numOptions + "em"

          tooltip.scrollTop = 0;

          isOpen = true;
          show(_config[0].preferAbove);
          textarea.setAttribute('aria-haspopup', 'listbox');
          updateActive();
        } else hide();
      } else hide();
    };

    const focusOut = (e: FocusEvent) => {
      if (_config[0].closeOnBlur != false && e.relatedTarget != textarea)
        hide();
    };

    const addSelectionHandler = () => {
      if (!cursor && (cursor = editor.extensions.cursor)) {
        // Must be added after the cursor's selectionChange handler
        cleanUps.push(
          editor.on('selectionChange', (selection) => {
            if (
              stops &&
              (selection[0] < stops[activeStop] ||
                selection[1] > stops[activeStop + 1])
            ) {
              clearStops();
            }
            if (shouldOpen) {
              shouldOpen = false;
              startQuery();
            } else hide();
          })
        );
      }
    };

    const cleanUps = [
      addTextareaListener(editor, 'mousedown', () => {
        if (stops) {
          setTimeout(() => {
            // Timeout runs before selectionChange, but after
            // the selection changes as a result of the click
            const [start, end] = getSelection();
            if (
              stops &&
              (start < stops[activeStop] || end > stops[activeStop + 1])
            ) {
              for (let i = 0, l = stops.length; i < stops.length; i += 2) {
                if (start >= stops[i] && end <= stops[i + 1]) {
                  if (i + 3 > l) clearStops();
                  else activeStop = i;
                  break;
                }
              }
            }
          });
        }
      }),
      addTextareaListener(
        editor,
        'beforeinput',
        (e) => {
          let inputType = e.inputType;
          let isDelete = inputType[0] == 'd';
          let isInsert = inputType == 'insertText';
          let data = e.data;
          if (
            isOpen &&
            isInsert &&
            !prevSelection &&
            data &&
            !data[1] &&
            currentOptions[activeIndex][4].commitChars?.includes(data)
          ) {
            insertOption(activeIndex);
          }

          if (stops) {
            currentSelection = getSelection();
            isDeleteForwards =
              isDelete &&
              inputType[13] == 'F' &&
              currentSelection[0] == currentSelection[1];
          }
          shouldOpen =
            (!_config[0].explicitOnly || isOpen) &&
            (shouldOpen ||
              (isInsert && !prevSelection) ||
              (isDelete && isOpen));
        },
        true
      ),
      addTextareaListener(editor, 'blur', (e) => {
        if (
          _config[0].closeOnBlur != false &&
          !tooltip.contains(e.relatedTarget as Element)
        )
          hide();
      }),
      addTextareaListener(
        editor,
        'keydown',
        (e) => {
          let key = e.key;
          let code = getModifierCode(e);
          let top: number;
          let height: number;
          let newActive: number;

          if (key == ' ' && code == 2) {
            addSelectionHandler();
            if (cursor) startQuery(true);
            preventDefault(e);
          } else if (!code && isOpen) {
            if (/^Arrow[UD]/.test(key)) {
              move(key[5] == 'U');
              preventDefault(e);
            } else if (/Tab|Enter/.test(key)) {
              insertOption(activeIndex);
              preventDefault(e);
            } else if (key == 'Escape') {
              hide();
              preventDefault(e);
            } else if (key.slice(0, 4) == 'Page') {
              measureRowHeight();
              top = tooltip.scrollTop;
              height = tooltip.clientHeight;
              if (key[4] == 'U') {
                newActive = Math.ceil(top / rowHeight);
                activeIndex =
                  activeIndex == newActive || newActive - 1 == activeIndex
                    ? Math.ceil(Math.max(0, (top - height) / rowHeight + 1))
                    : newActive;
              } else {
                top += height + 1;
                newActive = Math.ceil(top / rowHeight - 2);
                activeIndex =
                  activeIndex == newActive || newActive + 1 == activeIndex
                    ? Math.ceil(
                        Math.min(numOptions - 1, (top + height) / rowHeight - 3)
                      )
                    : newActive;
              }
              scrollActiveIntoView();
              updateActive();
              preventDefault(e);
            }
          } else if ((code & 7) == 0 && !isOpen && key == 'Tab' && stops) {
            if (!code) {
              moveActiveStop(2);
              if (activeStop + 3 > stops.length) clearStops();
              preventDefault(e);
            } else if (activeStop) {
              moveActiveStop(-2);
              preventDefault(e);
            }
          } else if (!isOpen && !code && key == 'Escape') {
            clearStops();
            preventDefault(e);
          }
        },
        true
      ),
      editor.on('update', () => {
        addSelectionHandler();

        if (stops) {
          let value = editor.value;
          let diff = prevLength - (prevLength = value.length);
          let [start, end] = currentSelection;
          let i = 0;
          let l = stops.length;
          let activeStart = stops[activeStop];
          let activeEnd = stops[activeStop + 1];

          if (start < stops[activeStop] || end > activeEnd) {
            clearStops();
          } else {
            if (isDeleteForwards) end++;
            if (end <= activeEnd) stops[activeStop + 1] -= diff;
            if (end <= activeStart && diff > 0) stops[activeStop] -= diff;
            for (; i < l; i += 2) {
              if (i != activeStop && stops[i] >= activeEnd) {
                stops[i] = Math.max(stops[i] - diff, stops[activeStop + 1]);
                stops[i + 1] = Math.max(
                  stops[i + 1] - diff,
                  stops[activeStop + 1]
                );
              }
            }
            updateStops();
          }
          isDeleteForwards = false;
          currentSelection = getSelection();
        }
      }),
      () => tooltip.removeEventListener('focusout', focusOut),
      () => {
        textarea.removeAttribute('aria-controls');
        textarea.removeAttribute('aria-autocomplete');
      },
      hide,
      clearStops,
    ];

    tabStopsContainer.className = 'pce-tabstops';
    textarea.setAttribute('aria-controls', id);
    textarea.setAttribute('aria-autocomplete', 'list');

    for (let i = 0; i < windowSize; ) {
      list.append(rowTemplate());
      rows[i].id = id + '-' + i++;
    }

    tooltip.onscroll = () => {
      measureRowHeight();
      const newOffset = Math.min(
        Math.floor(tooltip.scrollTop / rowHeight),
        numOptions - windowSize
      );
      if (newOffset == offset || newOffset < 0) return;

      offset = newOffset;
      for (let i = 0; i < windowSize; i) {
        updateRow(i++);
      }

      list.style.paddingTop = offset * rowHeight + 'px';
      updateActive();
    };

    list.onmousedown = (e) => {
      insertOption(
        [].indexOf.call(
          rows,
          (e.target as HTMLElement).closest('li') as never
        ) + offset
      );
      preventDefault(e);
    };
    tooltip.addEventListener('focusout', focusOut);

    return () => cleanUps.forEach((c) => c());
  }, []);
};

export { registerCompletions, useAutoComplete };
