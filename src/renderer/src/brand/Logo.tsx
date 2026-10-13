import type { SVGProps } from 'react'

type LogoProps = Omit<SVGProps<SVGSVGElement>, 'viewBox'> & { size?: number }

/**
 * The app's building artwork on its 160×160 Pen frame, taken from `design/html/logo-mark.html`
 * (each exported layer's viewBox offset folded into a translate; strokes scale with the art,
 * as in the 4x reference `design/system/logo/nO2LR.png`).
 */
function LogoArt({ size, ...rest }: LogoProps & { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 160 160"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      <g transform="translate(9.493 90.133)">
        <path
          d="M69.44 60.90667l-68.48-38.08c-0.53333-0.32-0.85333-0.74667-0.96-1.38668l0-6.29333 70.40001-15.14666 70.61334 14.93333 0 6.40001c0 0.64-0.32001 1.27999-0.95999 1.49333l-68.16002 38.08c-0.85333 0.42667-1.70667 0.42667-2.45334 0z"
          fill="#BBCAD4"
        />
      </g>
      <g transform="translate(9.662 69.44)">
        <path
          d="M69.0576 75.52l-68.16-38.18666c-1.06667-0.53333-1.28-1.70667-0.10667-2.34667l69.54667-34.98667 69.33334 34.98667c1.17334 0.74667 1.06667 1.70667 0 2.24l-67.84001 38.29333c-0.85334 0.42667-1.92001 0.42667-2.77333 0z"
          fill="#E6EDF1"
        />
      </g>
      <g transform="translate(34.24 18.667)">
        <path d="M0 20.16l36.90667-20.16 54.50668 20.16-45.65334 25.92001-45.76001-25.92001z" fill="#ECF3F4" />
      </g>
      <g transform="translate(34.24 21.227)">
        <path d="M0 17.6l31.68-17.6 28.48 0.10667 31.25335 17.49333" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(34.24 39.04)">
        <path d="M0 0l0 67.09334 45.76001 25.92 0-67.30667-45.76001-25.70667z" fill="#E6EDF1" />
      </g>
      <g transform="translate(42.453 26.24)">
        <path d="M0 12.58667l4.16 2.24 18.98667-10.34667 0-4.48-23.14667 12.58667z" fill="#63839B" />
      </g>
      <g transform="translate(94.293 26.347)">
        <path d="M0 3.94667l18.88 10.34666 3.94667-1.92-22.82667-12.37333 0 3.94667z" fill="#BBCAD4" />
      </g>
      <g transform="translate(42.453 26.347)">
        <path d="M0 12.48l23.14667-12.48 0 4.05333-18.98667 10.45334-4.16-2.02667z" fill="#63839B" />
      </g>
      <g transform="translate(80 39.04)">
        <path d="M0 25.70667l0 67.30667 45.65334-25.92 0-67.09334-45.65334 25.70667z" fill="#43667C" />
        <path
          d="M0 25.70667l0 67.30667 45.65334-25.92 0-67.09334-45.65334 25.70667z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(42.453 26.24)">
        <path
          d="M0 12.58667l37.54667 21.12 37.43999-21.12-23.14665-12.58667-28.69334 0-23.14667 12.58667z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(34.24 38.827)">
        <path
          d="M0 0l0 67.30667 45.76001 25.92 45.65334-25.92 0-67.30667-45.65334 25.92-45.76001-25.92z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(125.653 89.173)">
        <path d="M0 0l12.48 6.61333 0 6.18666-7.14666 3.84001-5.33334-2.88 0-13.76z" fill="#3FA35A" />
        <path
          d="M0 0l12.48 6.61333 0 6.18666-7.14666 3.84001-5.33334-2.88 0-13.76z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(125.653 89.173)">
        <path d="M0 0l12.48 6.61333-7.04001 3.84-5.43999-3.09333 0-7.36z" fill="#5BCD63" />
        <path
          d="M0 0l12.48 6.61333-7.04001 3.84-5.43999-3.09333 0-7.36z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(131.093 99.733)">
        <path d="M0 0l0 5.86667" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(21.333 85.12)">
        <path
          d="M12.90667 1.81332l-3.52-1.81332-9.38667 5.12 0 11.41333 7.46667 4.16 5.44-2.88 0-16.00001z"
          fill="#5BCD63"
        />
        <path
          d="M12.90667 1.81332l-3.52-1.81332-9.38667 5.12 0 11.41333 7.46667 4.16 5.44-2.88 0-16.00001z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(28.8 91.413)">
        <path d="M0 3.09333l0 11.30667 5.44-2.88 0-11.52-5.44 3.09333z" fill="#3FA35A" />
        <path
          d="M0 3.09333l0 11.30667 5.44-2.88 0-11.52-5.44 3.09333z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(21.333 90.24)">
        <path d="M0 0l7.46667 4.26666 5.44-3.09333" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(28.8 94.507)">
        <path d="M0 0l0 11.30667" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(50.347 99.093)">
        <path d="M0 0l0 16.32 12.90667 7.36 0-16.64-12.90667-7.04z" fill="#ECF3F4" />
      </g>
      <g transform="translate(50.347 99.093)">
        <path d="M0 0l0 16.32 12.90667 7.36 0-16.64-12.90667-7.04z" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(56.96 102.613)">
        <path d="M0 0l0 16.53333" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(40.32 52.693)">
        <path
          d="M0 0l0.10667 10.56 7.14666 4.16 0-10.34667-7.25333-4.37333z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(53.76 60.693)">
        <path
          d="M0 0l0 10.02667 7.25333 4.05333 0-9.92-7.25333-4.16z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(40.32 73.173)">
        <path
          d="M0 0l0 9.81334 7.14667 4.05333 0-9.70667-7.14667-4.16z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(53.76 80.533)">
        <path d="M0 0l0 9.81332 7.25333 4.16001 0-9.91999-7.25333-4.05334z" fill="#ECF3F4" />
      </g>
      <g transform="translate(53.76 80.533)">
        <path
          d="M0 0l0 9.81332 7.25333 4.16001 0-9.91999-7.25333-4.05334z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(66.987 68.16)">
        <path
          d="M0 0l0 10.02667 7.04 3.94667 0-10.02668-7.04-3.94666z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(66.987 87.787)">
        <path d="M0 0l0 9.70666 7.04 4.05334 0-9.70667-7.04-4.05333z" fill="#ECF3F4" />
      </g>
      <g transform="translate(66.987 88)">
        <path d="M0 0l0 9.49333 7.04 4.05333 0-9.70666-7.04-3.84z" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(96.853 99.093)">
        <path
          d="M12.69333 0.21333l-12.69333 6.82667 0 16.85334 12.69333-7.14667 0-16.74667 0 0.21333z"
          fill="#FFD18E"
        />
        <path
          d="M12.69333 0.21333l-12.69333 6.82667 0 16.85334 12.69333-7.14667 0-16.74667 0 0.21333z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(103.04 102.507)">
        <path d="M0 0l0.10667 16.74667" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(65.92 9.067)">
        <path d="M14.08 0l-14.08 7.68 0 18.56 14.08 7.57334 13.97333-7.57334 0-18.56-13.97333-7.68z" fill="#EAF4F4" />
        <path
          d="M14.08 0l-14.08 7.68 0 18.56 14.08 7.57334 13.97333-7.57334 0-18.56-13.97333-7.68z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(80 38.08)">
        <path d="M0 4.8l0 5.44 9.49333-4.90666 0-5.33334-9.49333 4.8z" fill="#CFDAE0" />
      </g>
      <g transform="translate(65.92 16.747)">
        <path
          d="M0 0l14.08 7.89333 13.97333-7.89333 0 18.56-13.97333 7.57334-14.08-7.57334 0-18.56z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.067}
        />
      </g>
      <g transform="translate(80 24.853)">
        <path d="M0 0l0 23.36" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(68.48 22.08)">
        <path
          d="M0 0l8.42667 4.58667 0 2.45333-2.98667-1.81333 0 8.85333-2.45334-1.38667 0-8.85333-2.98666-1.49333 0-2.34667z"
          fill="#0B243E"
        />
      </g>
      <g transform="translate(82.405 23.392)">
        <path
          d="M8.79462 3.06135c-0.85334-0.53333-1.6-0.53333-2.77333 0-1.17333 0.53333-2.77333 2.02667-3.09333 3.94667-0.42667 2.02666 0.64 3.73333 2.56 2.77333 1.17333-0.53333 1.91999-1.70667 2.13333-2.66666l1.49333 0.74666c-0.85333 1.81334-2.34666 3.62667-4.37333 4.48-3.30666 1.28-5.33334-0.53333-4.58667-4.58666 0.53333-2.98667 3.09334-6.18667 5.54667-7.25334 1.28001-0.53333 2.45334-0.74666 3.30667-0.10666l0.10666 0-1.49333 2.66666 1.17333 0z"
          fill="#0B243E"
        />
      </g>
      <g transform="translate(70.293 37.867)">
        <path d="M0 0l0 5.44" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(89.493 37.867)">
        <path d="M0 0l0 5.33333" fill="none" stroke="#102338" strokeWidth={1.067} />
      </g>
      <g transform="translate(85.76 68.16)">
        <path d="M0 3.94666l0 9.92001 7.14666-3.94667 0-9.92-7.14666 3.94666z" fill="#FFD18E" />
      </g>
      <g transform="translate(85.653 87.787)">
        <path d="M0 4.05333l7.25333-4.05333 0 9.70666-7.25333 4.05334 0-9.70667z" fill="#FFD18E" />
        <path
          d="M0 4.05333l7.25333-4.05333 0 9.70666-7.25333 4.05334 0-9.70667z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(99.307 60.693)">
        <path d="M0 4.16l0 9.81334 7.04-4.05334 0-9.92-7.04 4.16z" fill="#FFD18E" />
      </g>
      <g transform="translate(99.307 80.533)">
        <path d="M0 3.94666l0 9.81334 6.93333-4.16 0-9.6-6.93333 3.94666z" fill="#FFD18E" />
      </g>
      <g transform="translate(112.427 53.013)">
        <path d="M0 4.05333l0 10.34667 7.46667-4.48 0-9.92-7.46667 4.05333z" fill="#FFD18E" />
      </g>
      <g transform="translate(112.427 73.173)">
        <path d="M0 4.16l0 9.70667 7.46667-4.26666 0-9.60001-7.46667 4.16z" fill="#FFD18E" />
      </g>
      <g transform="translate(85.653 68.16)">
        <path d="M0 4.05333l7.25333-4.05333 0 9.92-7.25333 3.94667 0-9.81334z" fill="#FFD18E" />
        <path
          d="M0 4.05333l7.25333-4.05333 0 9.92-7.25333 3.94667 0-9.81334z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(99.307 60.693)">
        <path d="M0 4.16l6.93333-4.16 0 9.92-6.93333 3.94667 0-9.70667z" fill="#FFD18E" />
        <path
          d="M0 4.16l6.93333-4.16 0 9.92-6.93333 3.94667 0-9.70667z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(112.427 52.693)">
        <path d="M0 4.37333l7.46667-4.37333 0 10.34666-7.46667 4.37334 0-10.34667z" fill="#FFD18E" />
        <path
          d="M0 4.37333l7.46667-4.37333 0 10.34666-7.46667 4.37334 0-10.34667z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(112.427 73.173)">
        <path d="M0 4.16l7.46667-4.16 0 9.70666-7.46667 3.94668 0-9.49334z" fill="#FFD18E" />
        <path
          d="M0 4.16l7.46667-4.16 0 9.70666-7.46667 3.94668 0-9.49334z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(99.307 80.64)">
        <path d="M0 3.84l6.93333-3.84 0 9.49334-6.93333 4.05334 0-9.70668z" fill="#FFD18E" />
        <path
          d="M0 3.84l6.93333-3.84 0 9.49334-6.93333 4.05334 0-9.70668z"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
      <g transform="translate(85.653 87.787)">
        <path d="M0 4.05333l7.25333-4.05333 0 9.70666-7.25333 3.94667" fill="#FFD18E" />
        <path
          d="M0 4.05333l7.25333-4.05333 0 9.70666-7.25333 3.94667"
          fill="none"
          stroke="#102338"
          strokeWidth={1.014}
        />
      </g>
    </svg>
  )
}

/** The Pen `Logo Icon` (RIZV9): the App Mark at the top of the Company Rail. */
export function LogoIcon({ size = 34, ...rest }: LogoProps) {
  return <LogoArt size={size} data-ui="Logo Icon" {...rest} />
}

/** The Pen `Logo Mark` (nO2LR): the full-size mark, for the Launcher and an about page. */
export function LogoMark({ size = 160, ...rest }: LogoProps) {
  return <LogoArt size={size} data-ui="Logo Mark" {...rest} />
}
