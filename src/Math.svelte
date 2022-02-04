<script lang="ts">
    import { onMount } from "svelte";

    // import {MathQuill} from '@trevorhanus/mathquill-types'
    // const MQ = getInt

    import Equation from "./Equation.svelte";
    import Graph, { colors } from "./Graph.svelte";

    let hash = "trig";
    let elements;
    onMount(() => {
        if (window.location.hash !== "") {
            hash = window.location.hash.substring(1);
        }
        elements = document.querySelectorAll(".scroll");
    });

    const switchNav = (nav: string) => {
        hash = nav;
        window.location.hash = `#${nav}`;
    };
    let scrollY;

    $: {
        if (elements) {
            let element;
            for (const elem of elements) {
                if (elem.getBoundingClientRect().y + scrollY - 200 < scrollY) {
                    element = elem;
                }
            }

            if (element && hash !== element.id) {
                hash = element.id;
            }
        }
    }

</script>

<svelte:window bind:scrollY />
<div class="content">
    <h1>Assigment 0.2</h1>
    <h3>By Oliver Clarke</h3>
    <div id="sidenav">
        <div
            class={hash === "trig" ? "navselect" : ""}
            on:click={() => switchNav("trig")}
        >
            Trigonometric Equations
        </div>
        <div
            class={hash === "exp" ? "navselect" : ""}
            on:click={() => switchNav("exp")}
        >
            Exponential Equations
        </div>
        <div
            class={hash === "log" ? "navselect" : ""}
            on:click={() => switchNav("log")}
        >
            Logarithmic Equations
        </div>
        <div
            class={hash === "comb" ? "navselect" : ""}
            on:click={() => switchNav("comb")}
        >
            Combinations of functions
        </div>
    </div>
    <div class="main">
        <h2 id="trig" class="scroll">Trigonometric Functions</h2>
        <p>
            Trionometric functions are funcitons which describe the relationship
            of the angle of a <strong>right angled</strong> traingle and it's
            side lengths. These functions are periodic functinos meaning they
            repeat their values at regular intervals.<br />
            The most common trig functions are sine, cosine, and tangent with their
            respective reciprocals cosecant, secant, and cotangent. All of these
            functions have their inverse functions or arc functions that take a side
            length and produce an angle.<br />
        </p>
        <table>
            <tr>
                <td
                    ><Equation
                        >sin(x)\ \ \ \ x\ \in\ \R,\ \ \ y\ \in\ [-1, 1]</Equation
                    ></td
                >
                <td>
                    <Equation
                        >arcsin(x)\ \ \ \ x\ \in\ [-1, 1],\ \ \ y\ \in\
                        [-\frac\pi2, \frac\pi2]</Equation
                    >
                </td>
            </tr>
            <tr>
                <td>
                    <Equation
                        >cos(x)\ \ \ \ x\ \in\ \R,\ \ \ y\ \in\ [-1, 1]</Equation
                    >
                </td>
                <td>
                    <Equation
                        >arccos(x)\ \ \ \ x\ \in\ [-1, 1],\ \ \ y\ \in\ [0, \pi]</Equation
                    >
                </td>
            </tr>
            <tr>
                <td>
                    <Equation
                        >tan(x)\ \ \ \ x\ \in\ \R\ \ except\ \ x = \frac{"{"}\pi{"}"}{"{"}2{"}"}
                        \pm n\pi,\ \ \ y\ \in\ [-\infty, \infty]
                    </Equation>
                </td>
                <td>
                    <Equation
                        >arctan(x)\ \ \ \ x\ \in\ \R,\ \ \ y\ \in\ [-\frac\pi2,
                        \frac\pi2]</Equation
                    >
                </td>
            </tr>
        </table>

        <p>
            The general equation for sin is:
            <br />
            <br />
            <Equation>asin(b(x+c))</Equation>
            <br />
            <br />
            where a is amplitude, b is frequency/amplitude, and c is the phase shift
        </p>
        <h4>Important Angles</h4>
        <table>
            <tr>
                <th><Equation>\theta</Equation></th>
                <th><Equation>sin(\theta)</Equation></th>
                <th><Equation>cos(\theta)</Equation></th>
                <th><Equation>tan(\theta)</Equation></th>
                <th><Equation>csc(\theta)</Equation></th>
                <th><Equation>sec(\theta)</Equation></th>
                <th><Equation>cot(\theta)</Equation></th>
            </tr>
            <tr>
                <td>0</td>
                <td>0</td>
                <td>1</td>
                <td>0</td>
                <td>undefined</td>
                <td>1</td>
                <td>undefined</td>
            </tr>
            <tr>
                <td><Equation>\frac\pi2</Equation></td>
                <td>1</td>
                <td>0</td>
                <td>undefined</td>
                <td>0</td>
                <td>undefined</td>
                <td>1</td>
            </tr>
            <tr>
                <td><Equation>\pi</Equation></td>
                <td>0</td>
                <td>-1</td>
                <td>0</td>
                <td>undefined</td>
                <td>-1</td>
                <td>undefined</td>
            </tr>
            <tr>
                <td><Equation>\frac\pi6</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}2{"}"}</Equation></td>
                <td><Equation>\frac{"{"}\sqrt3{"}"}{"{"}2{"}"}</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}\sqrt3{"}"}</Equation></td>
                <td><Equation>\sqrt3</Equation></td>
                <td><Equation>\frac{"{"}2{"}"}{"{"}\sqrt3{"}"}</Equation></td>
                <td>2</td>
            </tr>
            <tr>
                <td><Equation>\frac\pi4</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}\sqrt2{"}"}</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}\sqrt2{"}"}</Equation></td>
                <td>1</td>
                <td>1</td>
                <td><Equation>\sqrt2</Equation></td>
                <td><Equation>\sqrt2</Equation></td>
            </tr>
            <tr>
                <td><Equation>\frac\pi3</Equation></td>
                <td><Equation>\frac{"{"}\sqrt3{"}"}{"{"}2{"}"}</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}2{"}"}</Equation></td>
                <td><Equation>\sqrt3</Equation></td>
                <td><Equation>\frac{"{"}1{"}"}{"{"}\sqrt3{"}"}</Equation></td>
                <td>2</td>
                <td><Equation>\frac{"{"}2{"}"}{"{"}\sqrt3{"}"}</Equation></td>
            </tr>
        </table>
        <h4>Graphs</h4>
        <div class="graphs">
            <Graph equation="y=\sin(x)" />
            <Graph equation="y=\sin(2x)" color={colors.GREEN} />
            <Graph equation="y=4\sin(x)" color={colors.ORANGE} />
            <Graph equation="y=2\cos(3x)" color={colors.PURPLE} />
            <Graph equation="y=\tan(x)" />
        </div>
        <h4>Unit Circle</h4>
        <p>
            The unit circle is a circle of radius 1. Because of this, it's easy
            to relate sin and cos to a line segment with an origin at (0, 0),
            with a length of 1, and angle <Equation>\theta</Equation> since these
            functions have a range of [-1, 1]: the angle of the line is used as the
            input to these functions, sin yields the y value of the point that the
            line falls on while cos produces the x value. The tan function produces
            the length of the tangent line of the point on the circle from itself
            to the x axis.
        </p>
        <Graph
            equation={[]}
            bounds={{ left: -1.2, right: 1.2, bottom: -1.2, top: 1.2 }}
            display={(calc) => {
                calc.setExpression({
                    id: "a",
                    latex: "a=0",
                    sliderBounds: { min: "0", max: "2*\\pi", isPlaying: true },
                });
                calc.setExpression({ latex: "y^2+x^2=1", color: colors.RED });
                calc.setExpression({
                    latex: "y=x\\tan(a) \\{{0<x<\\cos(a)\\}}",
                    color: colors.GREEN,
                });
                calc.setExpression({
                    latex: "y=x\\tan(a) \\{{\\cos(a)<x<0\\}}",
                    color: colors.GREEN,
                });
                calc.setExpression({
                    latex: "x=\\cos(a) \\{{0<y<\\sin(a)\\}}",
                    color: colors.PURPLE,
                });
                calc.setExpression({
                    latex: "x=\\cos(a) \\{{\\sin(a)<y<0\\}}",
                    color: colors.PURPLE,
                });
                calc.setExpression({
                    latex: "y=0 \\{{0<x<\\cos(a)\\}}",
                    color: colors.ORANGE,
                });
                calc.setExpression({
                    latex: "y=0 \\{{\\cos(a)<x<0\\}}",
                    color: colors.ORANGE,
                });
                calc.setExpression({
                    latex: "(\\cos(a), \\sin(a))",
                    color: colors.BLACK,
                });
                calc.setExpression({
                    latex: "y=-\\cot(a)(x-\\cos(a))+\\sin(a) \\{{0<y<\\sin(a)\\}}",
                    color: colors.BLACK,
                });
                calc.setExpression({
                    latex: "y=-\\cot(a)(x-\\cos(a))+\\sin(a) \\{{\\sin(a)<y<0\\}}",
                    color: colors.BLACK,
                });
                let state = calc.getState();
                state.expressions.list[0].slider.isPlaying = true;
                state.expressions.list[0].slider.loopMode = "LOOP_FORWARD";
                calc.setState(state);
            }}
            width={400}
            height={400}
        />
        <br />
        <p>
            As seen on the graph above, a triangle is formed out of the line
            described above, which is the hypotenuse, along with the lines
            created by the values of cos and sin. Hence, these trig functions
            can be used to solve for the side length and angles of a right
            triangle. For triangles with a hypotenuse greater than 1, we look
            back to the above definition of these functions and see that <Equation
                >sin(\theta)=y</Equation
            > and <Equation>cos(\theta)=x</Equation>. We also see that they must
            be in the range [-1, 1]. For triangles with hypotenuse greater than
            1, it is very likely that these side lengths will be greater than 1
            which would break this definition. To solve this we can normalize
            the x and y values by dividing them by the hypotenuse, gauranteein
            that they will be in the range [0, 1]. Therefore we can say <Equation
                >sin(\theta)=\frac{"{"}y{"}"}{"{"}hyp{"}"}</Equation
            > and <Equation>cos(\theta)=\frac{"{"}x{"}"}{"{"}hyp{"}"}</Equation
            >. Tangent can be defined as <Equation
                >\tan(\theta) =\frac{"{"}y{"}"}{"{"}x{"}"}</Equation
            > or
            <Equation
                >\tan(\theta) =\frac{"{"}sin(\theta){"}"}{"{"}cos(\theta){"}"}</Equation
            >.
        </p>
        <h4>Examples</h4>
        <p>
            Given a triangle has an angle of <Equation
                >\frac{"{"}\pi{"}"}6</Equation
            > with a hypotenuse of 8, find the opposite side of the angle:
            <br />
            <Equation>\sin(\theta) = \frac{"{"}opp{"}"}{"{"}hyp{"}"}</Equation>
            <br />
            <Equation>hyp\cdot\sin(\theta) = opp</Equation>
            <br />
            <Equation>8\cdot\sin(\frac{"{"}\pi{"}"}6) = opp</Equation>
            <br />
            <Equation>8\cdot\frac{"{"}\sqrt3{"}"}2 = opp</Equation>
            <br />
            <Equation>4\sqrt3 = opp</Equation>
            <br />
            <br />
            <br />
            A triangle has an opposite side length of 50 and an adjacent side length
            of 37. Find the angle <Equation>\theta</Equation>:
            <br />
            <Equation>\tan(\theta) = \frac{"{"}opp{"}"}{"{"}adj{"}"}</Equation>
            <br />
            <Equation
                >\theta = \arctan(\frac{"{"}opp{"}"}{"{"}adj{"}"})</Equation
            >
            <br />
            <Equation>\theta = \arctan(\frac{"{"}50{"}"}{"{"}37{"}"})</Equation>
            <br />
            <Equation>\theta = 0.9337</Equation>
            <br />
            <br />
            <br />
            <br />
        </p>

        <h2 id="exp" class="scroll">Exponential Functions</h2>
        <p>
            Exponential functions are those that include a variable in the
            exponent. They generally take the form:
            <br />
            <Equation>f(x)=b^x</Equation>
            <br />
            Where b (the base) is a constant and <Equation>b>0</Equation> and <Equation
                >b\ne1</Equation
            >.
        </p>
        <h4>Graphs</h4>
        <div class="graphs">
            <Graph equation="y=2^x" />
            <Graph equation="y=(\frac{'{'}1{'}'}2)^x" color={colors.GREEN} />
            <Graph equation="y=e^x" color={colors.ORANGE} />
            <Graph equation="y=-3^x" />
            <Graph
                equation="y=a^x"
                bounds={{ left: -8.2, right: 8.2, bottom: -8.2, top: 8.2 }}
                color={colors.BLUE}
                display={(calc) => {
                    calc.setExpression({
                        id: "a",
                        latex: "a=0.1",
                        sliderBounds: {
                            min: "0",
                            max: "4",
                        },
                    });

                    let state = calc.getState();
                    state.expressions.list[1].slider.isPlaying = true;
                    calc.setState(state);
                }}
            />
        </div>
        <h4>Exponent Rules</h4>
        <table>
            <tr>
                <td>Product Rule</td>
                <td><Equation>b^x \cdot b^y=b^{"{"}x+y{"}"}</Equation></td>
            </tr>
            <tr>
                <td>Quotient Rule</td>
                <td
                    ><Equation
                        >\frac{"{"}b^x{"}"}{"{"}b^y{"}"}=b^{"{"}x-y{"}"}</Equation
                    ></td
                >
            </tr>
            <tr>
                <td>Power Rule</td>
                <td><Equation>(b^x)^y=b^{"{"}xy{"}"}</Equation></td>
            </tr>
            <tr>
                <td>Power of Product Rule</td>
                <td><Equation>(ab)^x=a^xb^x</Equation></td>
            </tr>
            <tr>
                <td>Power of Quotient Rule</td>
                <td
                    ><Equation
                        >(\frac a b)^x=(\frac{"{"}a^x{"}"}
                        {"{"}b^x{"}"})</Equation
                    ></td
                >
            </tr>
            <tr>
                <td>Exponent of 0</td>
                <td><Equation>b^0=1</Equation></td>
            </tr>
            <tr>
                <td>Negative Exponent</td>
                <td
                    ><Equation>b^{"{"}-x{"}"}=\frac 1 {"{"}b^x{"}"}</Equation
                    ></td
                >
            </tr>
            <tr>
                <td>Fractional Exponent</td>
                <td><Equation>b^{"{"}\frac x y{"}"}=\sqrt[y]b^x</Equation></td>
            </tr>
        </table>

        <br />
        <br />
        <h2 id="log" class="scroll">Logarithmic Functions</h2>
        <p>
            Logarithmic functions are the inverse functions of exponential
            functions. Therefore, if <Equation>y=b^x</Equation>, then <Equation
                >x=\log_a y</Equation
            > where <Equation>y>0</Equation>. The logarithm with base <Equation
                >e</Equation
            > has a special name of natural log: <Equation>y=\ln x</Equation>
        </p>
        <h4>Graphs</h4>
        <div class="graphs">
            <Graph
                equation="y=\log_{'{'}10{'}'}x"
                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}
            />
            <Graph
                equation="y=\ln x"
                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}
                color={colors.GREEN}
            />

            <Graph
                equation="y=\log_{'{'}a{'}'}x"
                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}
                color={colors.BLUE}
                display={(calc) => {
                    calc.setExpression({
                        id: "a",
                        latex: "a=0.1",
                        sliderBounds: {
                            min: "0.1",
                            max: "4",
                        },
                    });

                    let state = calc.getState();
                    state.expressions.list[1].slider.isPlaying = true;
                    calc.setState(state);
                }}
            />
        </div>
        <h4>Log Rules</h4>
        <table>
            <tr>
                <td>Product Rule</td>
                <td><Equation>\log_a xy = \log_a x + \log_a y</Equation></td>
            </tr>
            <tr>
                <td>Quotient Rule</td>
                <td
                    ><Equation
                        >\log_a\frac{"{"}x{"}"}{"{"}y{"}"}=\log_a x - log_a y</Equation
                    ></td
                >
            </tr>
            <tr>
                <td>Power Rule</td>
                <td><Equation>\log_a x^b = b\log_a x</Equation></td>
            </tr>
            <tr>
                <td>Change of Base Rule</td>
                <td
                    ><Equation
                        >\log_a x = \frac{"{"}\log_b x{"}"}{"{"}log_b a{"}"}</Equation
                    ></td
                >
            </tr>
            <tr>
                <td>Equality Rule</td>
                <td><Equation>If \log_a x = log_a y\ then\ x=y</Equation></td>
            </tr>
            <tr>
                <td>Log of 1</td>
                <td><Equation>\log_a 1 = 0</Equation></td>
            </tr>
        </table>
        <br />
        <br />
        <h2 id="comb" class="scroll">Combinations of Functions</h2>
        <p>
            Functions can be added, subtracted, multiplied, and divided much
            like regular numbers. The basic forms of this for functions <Equation
                >f(x)</Equation
            > and <Equation>g(x)</Equation> are:
        </p>
        <br />
        <table>
            <tr>
                <td>Addition</td>
                <td><Equation>(f+g)(x) = f(x) + g(x)</Equation></td>
            </tr>
            <tr>
                <td>Subtraction</td>
                <td><Equation>(f-g)(x) = f(x) - g(x)</Equation></td>
            </tr>
            <tr>
                <td>Multiplication</td>
                <td><Equation>(f\cdot g)(x) = f(x) \cdot g(x)</Equation></td>
            </tr>
            <tr>
                <td>Division</td>
                <td
                    ><Equation
                        >(\frac f g)(x) = \frac{"{"}f(x){"}"}
                        {"{"}g(x){"}"}</Equation
                    >
                    where <Equation>g(x)\ne0</Equation>
                </td>
            </tr>
        </table>
        <p>
            The domain of the new combined function includes all the points for
            which the all the functions used to compose it are defined at that
            point.
        </p>
        <h4>Composition</h4>
        <p>
            Composition is slightly different as it is the process of plugging
            one function into another:
            <br />
            <Equation>(f\circ g)(x) = f(g(x))</Equation>
            <br />
            <br />
            Here f is said to be composed of g of x. Functions are evaluated from
            the inside out and is not cumulative.
            <br />
            The domain of a composed function is values of x that are in the domain
            of the inner function(s) that are in the domain of the outer.
        </p>
        <h4>Examples</h4>
        Using <Equation>f(x) = -5x-3</Equation> and <Equation
            >g(x)=x^2+8x+1</Equation
        >:
        <br />
        <ul>
            <li>
                Adding:
                <br />
                <Equation>(f+g)(x) = f(x) + g(x)</Equation>
                <br />
                <Equation>=(-5x-3) + (x^2+8x+1)</Equation>
                <br />
                <Equation>=-5x-3+x^2+8x+1</Equation>
                <br />
                <Equation>=x^2+3x-2</Equation>
                <br />
                <Equation>=x\in\R</Equation>
            </li>
            <br />
            <li>
                Subtracting:
                <br />
                <Equation>(f-g)(x) = f(x) - g(x)</Equation>
                <br />
                <Equation>=(-5x-3) - (x^2+8x+1)</Equation>
                <br />
                <Equation>=-5x-3-x^2-8x-1</Equation>
                <br />
                <Equation>=-x^2-13x-4</Equation>
                <br />
                <Equation>=x\in\R</Equation>
            </li>
            <br />
            <li>
                Multiplying:
                <br />
                <Equation>(f\cdot g)(x) = f(x) \cdot g(x)</Equation>
                <br />
                <Equation>=(-5x-3)(x^2+8x+1)</Equation>
                <br />
                <Equation>=-5x^3-40x^2-5x-3x^2-24x-3</Equation>
                <br />
                <Equation>=-5x^3-43x^2-29x-3</Equation>
                <br />
                <Equation>=x\in\R</Equation>
            </li>
            <br />
            <li>
                Dividing:
                <br />
                <Equation
                    >(\frac f g)(x) = \frac{"{"}f(x){"}"}
                    {"{"}g(x){"}"}</Equation
                >
                <br />
                <Equation
                    >=\frac{"{"}(-5x-3){"}"}
                    {"{"}(x^2+8x+1){"}"}</Equation
                >
                <br />
                <Equation>=x\in\R\ except\ x=\pm\sqrt{"{"}15{"}"}-4</Equation>
            </li>
            <br />
            <li>
                Composing:
                <br />
                <Equation>(f\circ g)(x) = f(g(x))</Equation>
                <br />
                <Equation>=-5(x^2+8x+1)-3</Equation>
                <br />
                <Equation>=-5x^2-40x-8</Equation>
                <br />
                <Equation>=x\in\R</Equation>
            </li>
        </ul>
        Compose <Equation>f(x)=\sqrt{"{"}-x-10{"}"}</Equation> and <Equation
            >g(x) = x^2+4x</Equation
        >:
        <br />
        <Equation>(f\circ g)(x) = f(g(x))</Equation>
        <br />
        <Equation>\sqrt{"{"}-(x^2+4x)-10{"}"}</Equation>
        <br />
        <Equation>\sqrt{"{"}-x^2-4x-10{"}"}</Equation>
        <br />
        <br />
        No values of x satisfy this equation because no values of <Equation
            >g(x)</Equation
        > are defined in <Equation>f</Equation> i.e. <Equation>g(x)</Equation> will
        always produce a negative number for which the square root is not defined
        for in the real plane.
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
    </div>
</div>

<style>
    #sidenav {
        padding-left: 20px;
        position: fixed;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    #sidenav > div {
        cursor: pointer;
    }

    #sidenav > :not(.navselect) {
        transition: color 400ms linear;
    }

    #sidenav > .navselect {
        color: var(--main-color);
    }

    @media screen and (max-width: 1450px) {
        #sidenav {
            display: none;
        }
    }

    .graphs {
        display: flex;
        /* padding-top: 50px; */
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 40px;
    }

    h3 {
        text-align: center;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
        color: var(--main-color);
    }

    ul {
        list-style: none;
    }

    .main {
        margin: 0 auto;
        margin-top: 50px;
        width: 800px;
        max-width: 80%;
    }

    h2 {
        text-align: center;
    }

    table {
        /* font-family: arial, sans-serif; */
        border-collapse: collapse;
        width: 100%;
    }

    td,
    th {
        border: 2px solid var(--main-color);
        text-align: left;
        padding: 8px;
    }

    /* tr:nth-child(even) {
        background-color: var(--sub-color);
    } */

    :global(body) {
        /* width: 100vw;
        height: 100vh; */
        background: linear-gradient(45deg, #272726, #3d3d3d, #3d3d3d, #272726);
        background-size: 400% 400%;
        background-attachment: fixed;
        background-repeat: no-repeat;
        animation: gradient 800s ease linear infinite;
        -moz-animation: gradient 800s linear infinite;
        -webkit-animation: gradient 800s linear infinite;
    }

    @keyframes gradient {
        0% {
            background-position: 0% 50%;
        }
        50% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0% 50%;
        }
    }
</style>
