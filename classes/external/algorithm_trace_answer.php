<?php
// This file is part of CodeRunner - http://coderunner.org.nz/
//
// CodeRunner is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// CodeRunner is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with CodeRunner.  If not, see <http://www.gnu.org/licenses/>.

namespace qtype_coderunner\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use context;

/**
 * Work out the correct answer to an algorithm_trace question, so the question
 * editor can fill in the sample answer or answer preload.
 *
 * The answer is computed by the algorithm library in the shipped
 * algorithm_trace prototype template, run on the sandbox, so it always matches
 * what the grader expects.
 *
 * @package    qtype_coderunner
 * @category   external
 * @copyright  2026
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class algorithm_trace_answer extends external_api {

    /**
     * Describe the parameters.
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'contextid' => new external_value(PARAM_INT, 'The context of the question editing page', VALUE_REQUIRED),
            'uiparameters' => new external_value(PARAM_RAW, 'The merged UI parameters, as JSON', VALUE_REQUIRED),
            'templateparams' => new external_value(PARAM_RAW, 'The question\'s template parameters (JSON or Twig)',
                VALUE_DEFAULT, ''),
            'steps' => new external_value(PARAM_INT, 'How many steps to return; 0 for all', VALUE_DEFAULT, 0),
        ]);
    }

    /**
     * Describe the result.
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'answer' => new external_value(PARAM_RAW, 'The serialised answer, or empty on error'),
            'steps' => new external_value(PARAM_INT, 'The number of steps in the answer'),
            'error' => new external_value(PARAM_TEXT, 'An error message, or empty'),
            'warning' => new external_value(PARAM_TEXT, 'Things the author should know about the trace, or empty'),
        ]);
    }

    /**
     * Compute the answer.
     * @param int $contextid The context of the editing page.
     * @param string $uiparameters The merged UI parameters (JSON).
     * @param string $templateparams The question's template parameters (JSON or Twig).
     * @param int $steps How many steps to return; 0 for all.
     * @return array
     */
    public static function execute(int $contextid, string $uiparameters, string $templateparams = '', int $steps = 0): array {
        $params = self::validate_parameters(self::execute_parameters(),
            ['contextid' => $contextid, 'uiparameters' => $uiparameters, 'templateparams' => $templateparams, 'steps' => $steps]);
        $context = context::instance_by_id($params['contextid']);
        self::validate_context($context);
        $editcaps = ['moodle/question:add', 'moodle/question:editall', 'moodle/question:editmine'];
        if (!has_any_capability($editcaps, $context)) {
            throw new \required_capability_exception($context, 'moodle/question:add', 'nopermissions', '');
        }

        $fail = fn($message) => ['answer' => '', 'steps' => 0, 'error' => $message, 'warning' => ''];
        $decoded = json_decode($params['uiparameters']);
        if (!is_object($decoded)) {
            return $fail(get_string('algorithmtrace_badparams', 'qtype_coderunner'));
        }
        if (($decoded->algorithm ?? '') === 'custom') {
            return $fail(get_string('algorithmtrace_nocustomfill', 'qtype_coderunner'));
        }
        $library = self::library();
        if ($library === null) {
            return $fail(get_string('algorithmtrace_nolibrary', 'qtype_coderunner'));
        }
        $templateparams = self::template_params_json($params['templateparams']);
        if (is_array($templateparams)) {
            return $fail($templateparams['error']);
        }
        // The inputs go on standard input, so they never need quoting as Python source.
        $program = $library . "\nimport sys\nrequest = json.loads(sys.stdin.read())\n" .
            "print(json.dumps(model_answer(request['uiparameters'], request['templateparams'], request['steps'])))\n";
        $input = json_encode(['uiparameters' => $params['uiparameters'], 'templateparams' => $templateparams,
            'steps' => max(0, $params['steps'])]);

        $sandbox = \qtype_coderunner_sandbox::get_best_sandbox('python3');
        if ($sandbox === null) {
            return $fail(get_string('wsnolanguage', 'qtype_coderunner', 'python3'));
        }
        $run = $sandbox->execute($program, 'python3', $input);
        if ($run->error !== \qtype_coderunner_sandbox::OK || $run->result !== \qtype_coderunner_sandbox::RESULT_SUCCESS) {
            $detail = trim(($run->cmpinfo ?? '') . ' ' . ($run->stderr ?? ''));
            return $fail(get_string('algorithmtrace_runfailed', 'qtype_coderunner', $detail));
        }
        $result = json_decode($run->output, true);
        if (!is_array($result)) {
            return $fail(get_string('algorithmtrace_runfailed', 'qtype_coderunner', trim($run->output)));
        }
        if (isset($result['error'])) {
            return $fail((string)$result['error']);
        }
        if (!isset($result['answer']) || !is_string($result['answer'])) {
            return $fail(get_string('algorithmtrace_runfailed', 'qtype_coderunner', trim($run->output)));
        }
        return ['answer' => $result['answer'], 'steps' => (int)($result['steps'] ?? 0), 'error' => '',
            'warning' => implode(' ', array_map('strval', $result['warnings'] ?? []))];
    }

    /**
     * The template parameters as JSON. They may be Twig (for example when they
     * randomise the data), in which case they are rendered first. If they can't
     * be turned into a JSON object, the settings in them (such as omitunchanged)
     * would be lost and the answer might not match the grader, so that's an error.
     * @param string $text The template parameters field.
     * @return string|array The JSON, or ['error' => message].
     */
    private static function template_params_json(string $text) {
        if (trim($text) === '') {
            return '{}';
        }
        $isobject = fn($json) => is_object(json_decode($json));
        if ($isobject($text)) {
            return $text;
        }
        try {
            $rendered = \qtype_coderunner_twig::render($text, []);
        } catch (\Throwable $e) {
            return ['error' => get_string('algorithmtrace_badtemplateparams', 'qtype_coderunner', $e->getMessage())];
        }
        if (trim($rendered) === '') {
            return '{}';
        }
        if (!$isobject($rendered)) {
            return ['error' => get_string('algorithmtrace_badtemplateparams', 'qtype_coderunner',
                get_string('algorithmtrace_notjsonobject', 'qtype_coderunner'))];
        }
        return $rendered;
    }

    /**
     * The Python algorithm library from the shipped algorithm_trace prototype.
     * @return string|null
     */
    private static function library(): ?string {
        global $CFG;
        $xml = simplexml_load_file($CFG->dirroot . '/question/type/coderunner/db/builtin_PROTOTYPES.xml');
        if ($xml === false) {
            return null;
        }
        foreach ($xml->question as $question) {
            if ((string)$question->coderunnertype === 'algorithm_trace' && (int)$question->prototypetype === 1) {
                $template = (string)$question->template;
                $start = strpos($template, '{% verbatim %}');
                $end = strpos($template, '{% endverbatim %}');
                if ($start === false || $end === false) {
                    return null;
                }
                $start += strlen('{% verbatim %}');
                return substr($template, $start, $end - $start);
            }
        }
        return null;
    }
}
