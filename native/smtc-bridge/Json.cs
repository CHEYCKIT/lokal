using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SmtcBridge
{
    /// <summary>
    /// The protocol between this process and Electron's main process
    /// (electron/ipc/smtc.js) is intentionally tiny -- one flat JSON object per
    /// line, only string/bool/number values, no nesting. That's small enough to
    /// hand-roll here rather than pull in a JSON NuGet package, which keeps this
    /// helper's dependency surface (and therefore its CI build risk) to just the
    /// one WinRT interop package it actually needs the SDK for.
    /// </summary>
    internal static class Json
    {
        public static string WriteObject(params (string key, object value)[] fields)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            for (int i = 0; i < fields.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(Escape(fields[i].key)).Append("\":");
                AppendValue(sb, fields[i].value);
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static void AppendValue(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    break;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    break;
                case int i:
                    sb.Append(i.ToString(CultureInfo.InvariantCulture));
                    break;
                case long l:
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                    break;
                case double d:
                    sb.Append(d.ToString(CultureInfo.InvariantCulture));
                    break;
                default:
                    sb.Append('"').Append(Escape(value.ToString())).Append('"');
                    break;
            }
        }

        private static string Escape(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Parses one flat JSON object into a string-keyed lookup of raw scalar
        /// values (bool/double/string, as C# object). Returns null on any
        /// malformed input rather than throwing -- a bad line from Electron
        /// should never take the whole bridge process down.
        /// </summary>
        public static Dictionary<string, object> ParseObject(string line)
        {
            try
            {
                int pos = 0;
                SkipWhitespace(line, ref pos);
                if (pos >= line.Length || line[pos] != '{') return null;
                pos++;

                var result = new Dictionary<string, object>();
                SkipWhitespace(line, ref pos);
                if (pos < line.Length && line[pos] == '}') return result;

                while (true)
                {
                    SkipWhitespace(line, ref pos);
                    string key = ParseString(line, ref pos);
                    SkipWhitespace(line, ref pos);
                    if (line[pos] != ':') return null;
                    pos++;
                    SkipWhitespace(line, ref pos);
                    object value = ParseValue(line, ref pos);
                    result[key] = value;
                    SkipWhitespace(line, ref pos);
                    if (pos >= line.Length) return null;
                    if (line[pos] == ',') { pos++; continue; }
                    if (line[pos] == '}') { pos++; break; }
                    return null;
                }
                return result;
            }
            catch
            {
                return null;
            }
        }

        private static object ParseValue(string s, ref int pos)
        {
            char c = s[pos];
            if (c == '"') return ParseString(s, ref pos);
            if (c == 't' && s.Substring(pos, 4) == "true") { pos += 4; return true; }
            if (c == 'f' && s.Substring(pos, 5) == "false") { pos += 5; return false; }
            if (c == 'n' && s.Substring(pos, 4) == "null") { pos += 4; return null; }
            // number
            int start = pos;
            while (pos < s.Length && (char.IsDigit(s[pos]) || s[pos] == '-' || s[pos] == '+' || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E'))
                pos++;
            return double.Parse(s.Substring(start, pos - start), CultureInfo.InvariantCulture);
        }

        private static string ParseString(string s, ref int pos)
        {
            if (s[pos] != '"') throw new System.FormatException("expected string");
            pos++;
            var sb = new StringBuilder();
            while (s[pos] != '"')
            {
                char c = s[pos];
                if (c == '\\')
                {
                    pos++;
                    char esc = s[pos];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            string hex = s.Substring(pos + 1, 4);
                            sb.Append((char)ushort.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            pos += 4;
                            break;
                        default: sb.Append(esc); break;
                    }
                    pos++;
                }
                else
                {
                    sb.Append(c);
                    pos++;
                }
            }
            pos++; // closing quote
            return sb.ToString();
        }

        private static void SkipWhitespace(string s, ref int pos)
        {
            while (pos < s.Length && char.IsWhiteSpace(s[pos])) pos++;
        }

        public static bool GetBool(this Dictionary<string, object> obj, string key, bool fallback)
        {
            return obj != null && obj.TryGetValue(key, out var v) && v is bool b ? b : fallback;
        }

        public static string GetString(this Dictionary<string, object> obj, string key, string fallback)
        {
            return obj != null && obj.TryGetValue(key, out var v) && v is string s ? s : fallback;
        }
    }
}
