import { ReactNode, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useCursorPosition } from './extensions/cursor';
import { PrismEditor } from './types';
import { createTemplate } from './utils/local';

const template = createTemplate(
  '<div class=pce-tooltip style=z-index:5;top:auto;display:flex;overflow-x:clip><div>'
);

/**
 * Moves to tooltip to align with the cursor and shows it.
 * @param preferPlacingAboveCursor Whether the preferred position is above the cursor or not.
 */
export type ShowTooltip = (preferPlacingAboveCursor?: boolean) => void;

/** Function removing the tooltip from the DOM. */
export type HideTooltip = () => void;

const show = (
  editor: PrismEditor,
  container: HTMLDivElement,
  spacerStyle: CSSStyleDeclaration,
  above?: boolean
) => {
  let cursor = editor.extensions.cursor;
  if (cursor) {
    let { left, right, top, bottom, height } = cursor.getPosition();
    const { clientHeight, clientWidth } = editor.container!;
    // AUIT
    //container.parentNode || editor.lines![0].append(container)
    container.parentNode ||
      (editor.lines &&
        editor.lines[0] &&
        editor.lines[0].parentNode &&
        editor.lines[0].parentNode.parentNode &&
        editor.lines[0].parentNode.parentNode.append(container));
    spacerStyle.width = '0px'; //(editor.props.rtl ? right : left) + "px"
    spacerStyle.display = 'none';
    //console.log("show",top,container,container.parentElement,container.parentElement.getBoundingClientRect())
    //container.parentElement.offsetTop
    let placeAbove =
      !above == top > bottom && (above ? top : bottom) < container.clientHeight
        ? !above
        : above;
    //document.body.appendChild(container);
    container.style.position = 'absolute';
    //container.style[placeAbove ? "bottom" : "top"] = height + (placeAbove ? bottom : top) + "px"
    //container.style[placeAbove ? "top" : "bottom"] = "auto"
    container.style.top =
      '' +
      (container.parentElement &&
        container.parentElement.offsetTop + 5.5 + 15.4 + top) +
      'px';
    //		container.style.left=''+((editor.props.rtl ? right : (container.parentElement&&container.parentElement.offsetLeft+left)) ) + "px";
    let ll = left < clientWidth - 300 ? left : clientWidth - 300;

    container.style.left = '' + (editor.props.rtl ? right : ll) + 'px';
    //container.style.maxHeight = '10em';

    /* 		container.style.top='100px';
		container.style.bottom='400px';
		container.style.height='500px'
 */
  }
};

/**
 * Same as {@link useTooltip} but accepts a JSX element instead of a DOM node.
 *
 * *Note:* Your tooltip element must have `flex-shrink: 0` if `fixedWidth` isn't set to
 * `false`.
 *
 * @param editor Editor you want to add the tooltip to.
 * @param element JSX element for the tooltip.
 * @param fixedWidth If false, the tooltip will shrink instead of getting offset to
 * the left if there's not enough space to the right of the cursor. Defaults to `true`.
 *
 * @example
 * ```jsx
 * const [show, hide, portal] = useReactTooltip(
 *   editor,
 *   <div style={{ flexShrink: 0 }}>My tooltip</div>,
 * )
 * ```
 * The portal should be returned from an extension.
 */
export const useReactTooltip = (
  editor: PrismEditor,
  element: ReactNode,
  fixedWidth = true
): [ShowTooltip, HideTooltip, ReactNode] => {
  const container = useMemo(template, []);
  const spacerStyle = (container.firstChild as HTMLDivElement).style;

  spacerStyle.flexShrink = fixedWidth ? '' : '0';

  return [
    useCallback(show.bind(editor, editor, container, spacerStyle), []),
    useCallback(() => container.remove(), []),
    createPortal(element, container),
  ];
};

/**
 * Utility making it easy to add tooltips positioned on the cursor to an editor. Before you
 * can show the tooltip, the {@link useCursorPosition} hook must've been called.
 *
 * This works by appending your tooltip to a flex container. You can style this container
 * with the selector `.pce-tooltip` if needed. It has `overflow-x: clip` to prevent your
 * tooltip from overflowing in browsers that support it.
 *
 * This utility is intended to be wrapped in a custom extension that controls when the
 * tooltip is shown. Your extension should then return the container returned by this
 * utility.
 *
 * If you want your tooltip to always be visible when scrolling horizontally, you can add
 * `position: sticky` along with the `right` and `left` CSS properties to it.
 *
 * @param editor Editor you want to add the tooltip to.
 * @param element HTML Element for the tooltip.
 * @param fixedWidth If false, the tooltip will shrink instead of getting offset to
 * the left if there's not enough space to the right of the cursor. Defaults to `true`.
 *
 * @example
 * const [show, hide] = useTooltip(editor, myElement)
 */
export const useTooltip = (
  editor: PrismEditor,
  element: HTMLElement,
  fixedWidth = true
): [ShowTooltip, HideTooltip] => {
  const container = useMemo(template, []);
  const spacerStyle = (container.firstChild as HTMLDivElement).style;

  useLayoutEffect(() => {
    container.append(element);
    return () => element.remove();
  }, [element]);

  spacerStyle.flexShrink = fixedWidth ? '' : '0';

  element.style.flexShrink = fixedWidth ? '0' : '';

  return [
    useCallback(show.bind(editor, editor, container, spacerStyle), []),
    useCallback(() => {
      container.remove(); //AUIT
    }, []),
  ];
};
