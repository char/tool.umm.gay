/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "calc",

  extras: $ => [/[ \t\r]+/, $.comment],

  word: $ => $.identifier,

  rules: {
    program: $ =>
      seq(
        repeat(choice(seq($._statement, $._terminator), $._terminator)),
        optional($._statement),
      ),

    _terminator: _ => choice("\n", ";"),

    _statement: $ => choice($.let_stmt, $._expression),
    let_stmt: $ => seq("let", field("name", $.identifier), "=", field("value", $._expression)),

    _expression: $ => choice($.convert, $._sum),

    convert: $ =>
      prec.left(
        5,
        seq(
          field("arg", $._sum),
          choice("→", "->", "to", "in"),
          field("targets", $.target_list),
        ),
      ),

    target_list: $ => prec.left(seq($._sum, repeat(seq(",", $._sum)))),

    _sum: $ => choice($.add, $._term),
    add: $ =>
      prec.left(
        10,
        seq(field("lhs", $._sum), field("op", choice("+", "-")), field("rhs", $._term)),
      ),

    _term: $ => choice($.mul, $._juxt),
    mul: $ =>
      prec.left(
        20,
        seq(
          field("lhs", $._term),
          field("op", choice("*", "/", "·", "×")),
          field("rhs", $._juxt),
        ),
      ),

    _juxt: $ => choice($.juxt, $._unary),
    juxt: $ => prec.left(30, seq(field("lhs", $._juxt), field("rhs", $._pow))),

    _unary: $ => choice($.unary, $._pow),
    unary: $ => prec(35, seq("-", field("arg", $._unary))),

    _pow: $ => choice($.pow, $._atom),
    pow: $ =>
      prec.right(
        40,
        seq(field("lhs", $._atom), field("op", choice("^", "**")), field("rhs", $._unary)),
      ),

    _atom: $ => choice($.number, $.hex, $.identifier, $.parens, $.call),

    parens: $ => seq("(", $._expression, ")"),

    call: $ =>
      prec(
        50,
        seq(
          field("fn", $.identifier),
          "(",
          optional(seq($._expression, repeat(seq(",", $._expression)))),
          ")",
        ),
      ),

    number: _ => /[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][-+]?[0-9]+)?/,
    hex: _ => /0[xX][0-9a-fA-F][0-9a-fA-F_]*/,
    identifier: _ => /[\p{L}_°][\p{L}\p{N}_]*/u,
    comment: _ => /#[^\n]*/,
  },
});
